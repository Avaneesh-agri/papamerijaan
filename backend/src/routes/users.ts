import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePrimaryAdmin, AuthedRequest, forbidden, clientIp } from '../middleware/auth';
import { getScope, loadOrg, subtreeIds, canSeeUser, isHead } from '../lib/org';
import { logActivity } from '../lib/audit';
import { notify } from '../lib/notify';
import { getSettings } from '../lib/settings';
import { publicUser } from './auth';
import { todayKey } from '../lib/time';

const router = Router();
router.use(requireAuth);

// ---------- LIST (scoped to own subtree; Primary Admin sees all) ----------
router.get('/', async (req: AuthedRequest, res) => {
  const { ids, all } = await getScope(req.user);
  const includeExited = req.query.includeExited === '1';
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] }, ...(includeExited ? {} : { status: 'ACTIVE' }) },
    orderBy: { name: 'asc' },
  });
  const settings = await getSettings();
  const showStipend = (u: any) => req.user.isPrimaryAdmin || (settings.heads_see_stipends && u.id !== req.user.id && ids.has(u.id));
  res.json({
    users: users.map((u) => ({
      ...publicUser(u),
      stipendAmount: req.user.isPrimaryAdmin || u.id === req.user.id ? u.stipendAmount : showStipend(u) ? u.stipendAmount : null,
      payDay: req.user.isPrimaryAdmin ? u.payDay : null,
    })),
    scopeAll: all,
  });
});

// ---------- ORG TREE (scoped) ----------
router.get('/tree', async (req: AuthedRequest, res) => {
  const { ids } = await getScope(req.user);
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, username: true, department: true, managerId: true, status: true, isPrimaryAdmin: true, photoFileId: true },
    orderBy: { name: 'asc' },
  });
  res.json({ users, rootId: req.user.isPrimaryAdmin ? null : req.user.id });
});

// ---------- CREATE (Primary Admin only — there is NO public signup) ----------
router.post('/', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const b = req.body || {};
  for (const f of ['name', 'username', 'email', 'phone', 'password']) {
    if (!b[f] || !String(b[f]).trim()) return res.status(400).json({ error: `${f} is required.` });
  }
  if (String(b.password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const clash = await prisma.user.findFirst({
    where: { OR: [{ username: { equals: b.username, mode: 'insensitive' } }, { email: { equals: b.email, mode: 'insensitive' } }] },
  });
  if (clash) return res.status(400).json({ error: 'Username or email already exists.' });
  if (b.managerId) {
    const mgr = await prisma.user.findUnique({ where: { id: b.managerId } });
    if (!mgr || mgr.status !== 'ACTIVE') return res.status(400).json({ error: 'Manager not found.' });
  }
  const settings = await getSettings();
  const user = await prisma.user.create({
    data: {
      name: b.name.trim(), username: b.username.trim().toLowerCase(), email: b.email.trim().toLowerCase(),
      phone: String(b.phone).trim(), passwordHash: await bcrypt.hash(String(b.password), 10),
      managerId: b.managerId || null, department: b.department || null, roleNotes: b.roleNotes || null,
      dateOfJoining: b.dateOfJoining || todayKey(),
      stipendAmount: b.stipendAmount ? Number(b.stipendAmount) : null,
      payDay: b.payDay ? Number(b.payDay) : 5,
      mustChangePassword: !!settings.force_password_change_on_first_login,
    },
  });
  await prisma.streak.create({ data: { userId: user.id } });
  await logActivity({ actorId: req.user.id, type: 'ACCOUNT_CREATED', targetUserId: user.id, detail: `Created account for ${user.name} (@${user.username})`, ip: clientIp(req) });
  if (user.managerId) await notify(user.managerId, { type: 'account', title: `${user.name} joined your team`, link: `/people/${user.id}` });
  res.json({ user: publicUser(user) });
});

// ---------- READ PROFILE ----------
router.get('/:id', async (req: AuthedRequest, res) => {
  if (!(await canSeeUser(req.user, req.params.id))) return forbidden(res);
  const u = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { manager: { select: { id: true, name: true, username: true } }, userDocuments: true },
  });
  if (!u) return res.status(404).json({ error: 'Not found' });
  const settings = await getSettings();
  const seeComp = req.user.isPrimaryAdmin || req.user.id === u.id || settings.heads_see_stipends;
  const org = await loadOrg();
  res.json({
    user: {
      ...publicUser(u),
      manager: u.manager,
      roleNotes: u.roleNotes,
      isHead: isHead(org, u.id),
      stipendAmount: seeComp ? u.stipendAmount : null,
      payCycle: seeComp ? u.payCycle : null,
      payDay: req.user.isPrimaryAdmin ? u.payDay : null,
      documents: req.user.isPrimaryAdmin || req.user.id === u.id ? u.userDocuments : [],
    },
  });
});

// ---------- UPDATE (Primary Admin; users may update own phone/photo) ----------
router.patch('/:id', async (req: AuthedRequest, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};

  if (!req.user.isPrimaryAdmin) {
    if (req.user.id !== target.id) return forbidden(res);
    const data: any = {};
    if (b.phone) data.phone = String(b.phone).trim();
    if (b.photoFileId !== undefined) data.photoFileId = b.photoFileId || null;
    const user = await prisma.user.update({ where: { id: target.id }, data });
    return res.json({ user: publicUser(user) });
  }

  const data: any = {};
  for (const f of ['name', 'phone', 'department', 'roleNotes', 'dateOfJoining', 'payCycle'] as const) {
    if (b[f] !== undefined) data[f] = b[f] === '' ? null : b[f];
  }
  if (b.username) data.username = String(b.username).trim().toLowerCase();
  if (b.email) data.email = String(b.email).trim().toLowerCase();
  if (b.photoFileId !== undefined) data.photoFileId = b.photoFileId || null;
  if (b.stipendAmount !== undefined) data.stipendAmount = b.stipendAmount === '' || b.stipendAmount === null ? null : Number(b.stipendAmount);
  if (b.payDay !== undefined) data.payDay = Number(b.payDay) || 5;
  if (b.managerId !== undefined) {
    if (b.managerId) {
      if (b.managerId === target.id) return res.status(400).json({ error: 'A user cannot report to themself.' });
      const org = await loadOrg();
      if (subtreeIds(org, target.id).has(b.managerId)) return res.status(400).json({ error: 'That would create a loop — the chosen manager is inside this person’s own subtree.' });
      data.managerId = b.managerId;
    } else data.managerId = null;
  }
  if (b.password) {
    if (String(b.password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    data.passwordHash = await bcrypt.hash(String(b.password), 10);
    data.mustChangePassword = !!b.forceChange;
    // Password reset revokes all of the user's sessions
    await prisma.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'FORCED' } });
    await logActivity({ actorId: req.user.id, type: 'PASSWORD_RESET', targetUserId: target.id, detail: `Reset password for ${target.name}`, ip: clientIp(req) });
  }
  const user = await prisma.user.update({ where: { id: target.id }, data });
  if (b.managerId !== undefined && b.managerId !== target.managerId) {
    await logActivity({ actorId: req.user.id, type: 'ORG_CHANGE', targetUserId: target.id, detail: `Changed manager for ${target.name}`, meta: { from: target.managerId, to: b.managerId }, ip: clientIp(req) });
  } else {
    await logActivity({ actorId: req.user.id, type: 'ACCOUNT_UPDATED', targetUserId: target.id, detail: `Updated profile of ${target.name}`, ip: clientIp(req) });
  }
  res.json({ user: publicUser(user) });
});

// ---------- PROFILE DOCUMENTS ----------
router.post('/:id/documents', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const { fileId, label } = req.body || {};
  if (!fileId || !label) return res.status(400).json({ error: 'fileId and label required' });
  const doc = await prisma.userDocument.create({ data: { userId: req.params.id, fileId, label } });
  await logActivity({ actorId: req.user.id, type: 'ACCOUNT_UPDATED', targetUserId: req.params.id, detail: `Uploaded document "${label}"` });
  res.json({ document: doc });
});

// ---------- OFFBOARDING: deactivate in ONE action ----------
router.post('/:id/deactivate', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'Not found' });
  if (target.isPrimaryAdmin) return res.status(400).json({ error: 'The Primary Admin account cannot be deactivated.' });
  if (target.status === 'EXITED') return res.status(400).json({ error: 'Already exited.' });

  // 1. Instantly revoke ALL sessions and block login
  await prisma.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'DEACTIVATED' } });
  // 2. Retain everything — just mark Exited with exit date. NOTHING is deleted.
  await prisma.user.update({ where: { id: target.id }, data: { status: 'EXITED', exitDate: todayKey() } });
  // Reports of this person now report to their manager (org integrity)
  await prisma.user.updateMany({ where: { managerId: target.id }, data: { managerId: target.managerId } });

  await logActivity({ actorId: req.user.id, type: 'ACCOUNT_DEACTIVATED', targetUserId: target.id, detail: `Deactivated ${target.name} — all sessions revoked, records retained`, ip: clientIp(req) });
  res.json({ ok: true });
});

// ---------- EXIT CHECKLIST (open tasks to reassign + credentials ever revealed) ----------
router.get('/:id/exit-checklist', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'Not found' });

  const openAssignments = await prisma.taskAssignee.findMany({
    where: { userId: target.id, status: { notIn: ['APPROVED'] }, task: { archived: false, isRecurringTemplate: false } },
    include: { task: { select: { id: true, title: true, dueAt: true, priority: true, createdById: true } } },
  });

  // Pulled from the vault reveal log: every credential this person EVER viewed → rotate
  const reveals = await prisma.vaultViewLog.findMany({
    where: { userId: target.id, action: 'REVEAL' },
    include: { item: { select: { id: true, name: true, loginEmail: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const seen = new Set<string>();
  const credentials = reveals
    .filter((r) => (seen.has(r.itemId) ? false : (seen.add(r.itemId), true)))
    .map((r) => ({ itemId: r.itemId, name: r.item.name, loginEmail: r.item.loginEmail, lastRevealedAt: r.createdAt }));

  res.json({
    user: publicUser(target),
    openTasks: openAssignments.map((a) => ({ assigneeRowId: a.id, taskId: a.task.id, title: a.task.title, dueAt: a.task.dueAt, priority: a.task.priority, status: a.status })),
    credentialsToRotate: credentials,
    physicalAssets: ['Laptop / devices', 'SIM cards held', 'ID card / keys', 'Any company documents'],
  });
});

// ---------- One-click reassignment of an exited user's open task ----------
router.post('/:id/reassign-task', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const { taskId, toUserId } = req.body || {};
  const to = await prisma.user.findUnique({ where: { id: toUserId } });
  if (!to || to.status !== 'ACTIVE') return res.status(400).json({ error: 'Choose an active user.' });
  const existing = await prisma.taskAssignee.findUnique({ where: { taskId_userId: { taskId, userId: req.params.id } } });
  if (!existing) return res.status(404).json({ error: 'Assignment not found' });
  await prisma.taskAssignee.upsert({
    where: { taskId_userId: { taskId, userId: toUserId } },
    update: {},
    create: { taskId, userId: toUserId, assignedById: req.user.id },
  });
  await prisma.taskHistory.create({ data: { taskId, actorId: req.user.id, action: 'REASSIGNED', detail: { from: req.params.id, to: toUserId } } });
  await notify(toUserId, { type: 'task', title: 'A task was reassigned to you', link: `/tasks/${taskId}` });
  await logActivity({ actorId: req.user.id, type: 'TASK_REASSIGNED', targetUserId: toUserId, detail: `Reassigned a task from exited user`, meta: { taskId } });
  res.json({ ok: true });
});

// ---------- PERFORMANCE (visible to self, their managers, admin) ----------
router.get('/:id/performance', async (req: AuthedRequest, res) => {
  if (!(await canSeeUser(req.user, req.params.id))) return forbidden(res);
  const userId = req.params.id;
  const assignments = await prisma.taskAssignee.findMany({
    where: { userId, task: { isRecurringTemplate: false } },
    include: { task: { select: { dueAt: true } } },
  });
  const submissions = await prisma.submission.findMany({ where: { userId }, select: { taskId: true, submittedAt: true, reviewStatus: true, attempt: true } });
  const subByTask = new Map<string, any>();
  for (const s of submissions) {
    const cur = subByTask.get(s.taskId);
    if (!cur || s.attempt < cur.attempt) subByTask.set(s.taskId, s); // earliest attempt
  }
  let completed = 0, late = 0, onTime = 0, withDeadline = 0;
  for (const a of assignments) {
    if (a.status === 'APPROVED') completed++;
    const sub = subByTask.get(a.taskId);
    if (a.task.dueAt) {
      withDeadline++;
      if (sub) {
        if (new Date(sub.submittedAt) <= new Date(a.task.dueAt)) onTime++;
        else late++;
      } else if (new Date(a.task.dueAt) < new Date()) late++;
    }
  }
  const streak = await prisma.streak.findUnique({ where: { userId } });
  const reports = await prisma.dailyReport.findMany({ where: { userId, status: { not: 'DRAFT' } }, select: { late: true } });
  res.json({
    stats: {
      totalAssigned: assignments.length,
      completed,
      onTimePct: withDeadline ? Math.round((onTime / withDeadline) * 100) : null,
      lateCount: late,
      reportsSubmitted: reports.length,
      reportsLate: reports.filter((r) => r.late).length,
      currentStreak: streak?.current ?? 0,
      bestStreak: streak?.best ?? 0,
    },
  });
});

export default router;
