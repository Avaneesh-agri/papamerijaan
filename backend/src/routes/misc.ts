import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePrimaryAdmin, AuthedRequest, forbidden, clientIp } from '../middleware/auth';
import { getScope, loadOrg, subtreeIds, ancestorIds, isHead } from '../lib/org';
import { logActivity } from '../lib/audit';
import { getSettings, setSetting, DEFAULT_SETTINGS } from '../lib/settings';
import { todayKey, addDaysKey, dayBounds, monthOfKey } from '../lib/time';
import { ensureStipendRecords } from './hr';
import { catchUpStreaks } from '../lib/streakEngine';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB cap (files live in Postgres)

// ============================================================ FILES
router.post('/files', requireAuth, upload.single('file'), async (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received (10 MB max).' });
  const f = await prisma.fileObject.create({
    data: {
      name: req.file.originalname || 'file', mime: req.file.mimetype || 'application/octet-stream',
      size: req.file.size, data: new Uint8Array(req.file.buffer), uploadedById: req.user.id,
      scope: String(req.body?.scope || 'GENERAL'),
    },
  });
  res.json({ file: { id: f.id, name: f.name, size: f.size, mime: f.mime } });
});

router.get('/files/:id', requireAuth, async (req: AuthedRequest, res) => {
  const f = await prisma.fileObject.findUnique({ where: { id: req.params.id } });
  if (!f) return res.status(404).json({ error: 'Not found' });

  let allowed = req.user.isPrimaryAdmin || f.uploadedById === req.user.id;
  if (!allowed && f.uploadedById) {
    const org = await loadOrg();
    allowed = subtreeIds(org, req.user.id).has(f.uploadedById); // manager chain can view team files
  }
  if (!allowed) {
    // shared via a task the requester participates in?
    const res1 = await prisma.taskResource.findFirst({ where: { fileId: f.id } });
    if (res1) {
      const a = await prisma.taskAssignee.findFirst({ where: { taskId: res1.taskId, userId: req.user.id } });
      const t = await prisma.task.findUnique({ where: { id: res1.taskId } });
      allowed = !!a || t?.createdById === req.user.id;
    }
  }
  if (!allowed && f.scope === 'PROFILE') allowed = true; // avatars are company-visible
  if (!allowed) return forbidden(res);

  res.setHeader('Content-Type', f.mime);
  const disposition = req.query.download === '1' ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(f.name)}"`);
  res.send(Buffer.from(f.data));
});

// ============================================================ NOTIFICATIONS
router.get('/notifications', requireAuth, async (req: AuthedRequest, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' }, take: 100,
  });
  // Alerts pinned on top until read
  notifications.sort((a, b) => {
    const aa = a.level === 'ALERT' && !a.readAt ? 0 : 1;
    const bb = b.level === 'ALERT' && !b.readAt ? 0 : 1;
    return aa - bb || +new Date(b.createdAt) - +new Date(a.createdAt);
  });
  res.json({ notifications });
});

router.get('/notifications/unread-count', requireAuth, async (req: AuthedRequest, res) => {
  const count = await prisma.notification.count({ where: { userId: req.user.id, readAt: null } });
  const alerts = await prisma.notification.count({ where: { userId: req.user.id, readAt: null, level: 'ALERT' } });
  res.json({ count, alerts });
});

router.post('/notifications/read', requireAuth, async (req: AuthedRequest, res) => {
  const ids = req.body?.ids as string[] | undefined;
  await prisma.notification.updateMany({
    where: { userId: req.user.id, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  res.json({ ok: true });
});

// ============================================================ ANNOUNCEMENTS
router.get('/announcements', requireAuth, async (req: AuthedRequest, res) => {
  const list = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { reads: true } });
  const users = await prisma.user.count({ where: { status: 'ACTIVE' } });
  res.json({
    announcements: list.map((a) => ({
      id: a.id, title: a.title, body: a.body, createdAt: a.createdAt,
      readByMe: a.reads.some((r) => r.userId === req.user.id),
      readCount: a.reads.length, totalUsers: users,
      readers: req.user.isPrimaryAdmin ? a.reads.map((r) => r.userId) : undefined,
    })),
  });
});

router.post('/announcements', requireAuth, requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const { title, body } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'Title and body required.' });
  const a = await prisma.announcement.create({ data: { title, body, createdById: req.user.id } });
  const users = await prisma.user.findMany({ where: { status: 'ACTIVE', id: { not: req.user.id } }, select: { id: true } });
  const { notify } = await import('../lib/notify');
  await notify(users.map((u) => u.id), { type: 'announcement', title: `📢 ${title}`, body: String(body).slice(0, 140), link: '/announcements' });
  await logActivity({ actorId: req.user.id, type: 'ANNOUNCEMENT_POSTED', detail: `Posted announcement "${title}"` });
  res.json({ announcement: a });
});

router.post('/announcements/:id/read', requireAuth, async (req: AuthedRequest, res) => {
  await prisma.announcementRead.upsert({
    where: { announcementId_userId: { announcementId: req.params.id, userId: req.user.id } },
    update: {}, create: { announcementId: req.params.id, userId: req.user.id },
  });
  res.json({ ok: true });
});

// ============================================================ ACTIVITY LOG (append-only; scoped)
router.get('/activity', requireAuth, async (req: AuthedRequest, res) => {
  const { ids, all } = await getScope(req.user);
  const person = req.query.person ? String(req.query.person) : null;
  const type = req.query.type ? String(req.query.type) : null;
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const page = Math.max(1, Number(req.query.page) || 1);

  const where: any = {};
  if (!all) where.actorId = { in: [...ids] };
  if (person) {
    if (!all && !ids.has(person)) return forbidden(res);
    where.actorId = person;
  }
  if (type) where.type = { contains: type, mode: 'insensitive' };
  if (from) where.createdAt = { ...(where.createdAt || {}), gte: dayBounds(from).start };
  if (to) where.createdAt = { ...(where.createdAt || {}), lt: dayBounds(to).end };

  const [total, logs] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50, skip: (page - 1) * 50 }),
  ]);
  const uids = [...new Set(logs.flatMap((l) => [l.actorId, l.targetUserId].filter(Boolean)))] as string[];
  const users = await prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true } });
  res.json({ logs, total, page, users: Object.fromEntries(users.map((u) => [u.id, u.name])) });
});

router.get('/activity/export.csv', requireAuth, async (req: AuthedRequest, res) => {
  const { ids, all } = await getScope(req.user);
  const where: any = all ? {} : { actorId: { in: [...ids] } };
  const logs = await prisma.activityLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000 });
  const uids = [...new Set(logs.map((l) => l.actorId).filter(Boolean))] as string[];
  const users = await prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true } });
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Time (UTC)', 'Actor', 'Type', 'Detail', 'IP'].join(',')];
  for (const l of logs) rows.push([l.createdAt.toISOString(), names[l.actorId || ''] || '', l.type, l.detail, l.ip || ''].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="asscher-activity-log.csv"');
  res.send(rows.join('\n'));
});

// ============================================================ GLOBAL SEARCH (always permission-scoped)
router.get('/search', requireAuth, async (req: AuthedRequest, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ tasks: [], people: [], queries: [], videos: [], vault: [] });
  const { ids, all } = await getScope(req.user);
  const idList = [...ids];

  const [tasks, people, queries, videos] = await Promise.all([
    prisma.task.findMany({
      where: {
        title: { contains: q, mode: 'insensitive' }, isRecurringTemplate: false,
        ...(all ? {} : { OR: [{ createdById: { in: idList } }, { assignees: { some: { userId: { in: idList } } } }] }),
      },
      select: { id: true, title: true, priority: true, dueAt: true }, take: 8,
    }),
    prisma.user.findMany({
      where: { id: { in: idList }, OR: [{ name: { contains: q, mode: 'insensitive' } }, { username: { contains: q, mode: 'insensitive' } }] },
      select: { id: true, name: true, username: true, department: true, status: true }, take: 8,
    }),
    prisma.query.findMany({
      where: {
        title: { contains: q, mode: 'insensitive' },
        ...(all ? {} : { OR: [{ raisedById: { in: idList } }, { assignedToId: { in: idList } }] }),
      },
      select: { id: true, title: true, level: true, status: true }, take: 8,
    }),
    prisma.video.findMany({
      where: { active: true, OR: [{ title: { contains: q, mode: 'insensitive' } }, { category: { contains: q, mode: 'insensitive' } }] },
      select: { id: true, title: true, category: true }, take: 8,
    }),
  ]);

  let vault: any[] = [];
  if (req.user.isPrimaryAdmin) {
    vault = await prisma.vaultItem.findMany({ where: { name: { contains: q, mode: 'insensitive' } }, select: { id: true, name: true }, take: 8 });
  } else {
    const acc = await prisma.vaultAccess.findMany({ where: { userId: req.user.id }, include: { item: { select: { id: true, name: true } } } });
    vault = acc.filter((a) => a.item.name.toLowerCase().includes(q.toLowerCase())).map((a) => a.item).slice(0, 8);
  }
  res.json({ tasks, people, queries, videos, vault });
});

// ============================================================ SETTINGS
router.get('/settings', requireAuth, async (req: AuthedRequest, res) => {
  const s = await getSettings();
  if (req.user.isPrimaryAdmin) return res.json({ settings: s, keys: Object.keys(DEFAULT_SETTINGS) });
  res.json({ settings: { company_name: s.company_name, eod_time: s.eod_time } });
});

router.put('/settings', requireAuth, requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const updates = req.body?.settings || {};
  for (const [k, v] of Object.entries(updates)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    await setSetting(k, v);
  }
  await logActivity({ actorId: req.user.id, type: 'SETTINGS_UPDATED', detail: `Updated app settings: ${Object.keys(updates).join(', ')}`, ip: clientIp(req) });
  res.json({ settings: await getSettings() });
});

// ============================================================ DASHBOARD (role-aware home)
router.get('/dashboard', requireAuth, async (req: AuthedRequest, res) => {
  // lazy catch-up: streaks + stipends stay correct even on sleepy free-tier hosts
  catchUpStreaks().catch(() => {});
  ensureStipendRecords().catch(() => {});

  const today = todayKey();
  const { start, end } = dayBounds(today);
  const org = await loadOrg();
  const me = req.user;

  const myAssignments = await prisma.taskAssignee.findMany({
    where: { userId: me.id, task: { isRecurringTemplate: false, archived: false, dueAt: { gte: start, lt: end } } },
    include: { task: { select: { id: true, title: true, dueAt: true, priority: true } } },
  });
  const myOpenTasks = await prisma.taskAssignee.count({ where: { userId: me.id, status: { in: ['ASSIGNED', 'OPENED', 'IN_PROGRESS', 'RETURNED'] }, task: { isRecurringTemplate: false, archived: false } } });
  const streak = await prisma.streak.findUnique({ where: { userId: me.id } });
  const myQueries = await prisma.query.findMany({ where: { raisedById: me.id, status: { not: 'RESOLVED' } }, take: 5, orderBy: { updatedAt: 'desc' } });
  const myReport = await prisma.dailyReport.findUnique({ where: { userId_dateKey: { userId: me.id, dateKey: today } } });
  const holiday = await prisma.holiday.findUnique({ where: { dateKey: today } });
  const myLeave = await prisma.leave.findFirst({ where: { userId: me.id, status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today } } });
  const settings = await getSettings();

  const payload: any = {
    today, eodTime: settings.eod_time, holiday, onLeave: !!myLeave,
    myTasks: myAssignments.map((a) => ({ taskId: a.task.id, title: a.task.title, dueAt: a.task.dueAt, priority: a.task.priority, status: a.status })),
    myOpenTasks, streak: streak || { current: 0, best: 0 }, myQueries,
    myReportStatus: myReport?.status || 'NOT_FILED', myReportLate: myReport?.late || false,
  };

  const directs = await prisma.user.findMany({ where: { managerId: me.id, status: 'ACTIVE' }, select: { id: true, name: true, username: true, photoFileId: true } });
  payload.isHead = directs.length > 0;

  if (directs.length) {
    // live team board: person × today's tasks with statuses and read receipts
    const teamIds = directs.map((d) => d.id);
    const teamAssignments = await prisma.taskAssignee.findMany({
      where: { userId: { in: teamIds }, task: { isRecurringTemplate: false, archived: false, dueAt: { gte: start, lt: end } } },
      include: { task: { select: { id: true, title: true, dueAt: true, priority: true } } },
    });
    const teamReports = await prisma.dailyReport.findMany({ where: { dateKey: today, userId: { in: teamIds } } });
    const teamQueries = await prisma.query.findMany({ where: { assignedToId: me.id, status: { not: 'RESOLVED' } }, orderBy: { updatedAt: 'desc' }, take: 10 });
    const qNames = await prisma.user.findMany({ where: { id: { in: [...new Set(teamQueries.map((x) => x.raisedById))] } }, select: { id: true, name: true } });
    const pendingLeaves = await prisma.leave.findMany({ where: { status: 'PENDING', user: { managerId: me.id } }, include: { user: { select: { id: true, name: true } } } });
    const teamLeaveToday = await prisma.leave.findMany({ where: { status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today }, userId: { in: teamIds } }, include: { user: { select: { name: true } } } });
    const teamStreaks = await prisma.streak.findMany({ where: { userId: { in: teamIds } } });

    payload.team = {
      board: directs.map((d) => ({
        user: d,
        tasks: teamAssignments.filter((a) => a.userId === d.id).map((a) => ({ taskId: a.task.id, title: a.task.title, status: a.status, firstOpenedAt: a.firstOpenedAt, priority: a.task.priority, dueAt: a.task.dueAt })),
        report: teamReports.find((r) => r.userId === d.id)?.status || 'NOT_FILED',
        reportLate: teamReports.find((r) => r.userId === d.id)?.late || false,
        onLeave: teamLeaveToday.some((l) => (l as any).userId === d.id),
        streak: teamStreaks.find((s) => s.userId === d.id)?.current ?? 0,
      })),
      queries: teamQueries.map((q) => ({ ...q, raisedByName: qNames.find((n) => n.id === q.raisedById)?.name })),
      pendingLeaves,
      reportsToReview: teamReports.filter((r) => r.status === 'SUBMITTED').length,
    };
  }

  if (me.isPrimaryAdmin) {
    await ensureStipendRecords();
    const users = await prisma.user.findMany({ where: { status: 'ACTIVE' } });
    const roots = users.filter((u) => u.managerId === me.id);
    const dueTodayAll = await prisma.taskAssignee.findMany({
      where: { task: { isRecurringTemplate: false, archived: false, dueAt: { gte: start, lt: end } } },
      include: { task: { select: { dueAt: true } } },
    });
    const byDept = roots.map((r) => {
      const set = subtreeIds(org, r.id);
      const rows = dueTodayAll.filter((a) => set.has(a.userId));
      const done = rows.filter((a) => ['SUBMITTED', 'APPROVED'].includes(a.status));
      const late = rows.filter((a) => !['SUBMITTED', 'APPROVED'].includes(a.status) && a.task.dueAt && new Date(a.task.dueAt) < new Date());
      return { label: r.department || r.name, rootId: r.id, assigned: rows.length, done: done.length, pending: rows.length - done.length, late: late.length };
    });
    const openAlerts = await prisma.query.count({ where: { level: 'ALERT', status: { not: 'RESOLVED' } } });
    const overdue = await prisma.stipendRecord.findMany({ where: { paidAt: null, dueDate: { lt: today } }, include: { user: { select: { name: true } } } });
    const onLeaveToday = await prisma.leave.findMany({ where: { status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today } }, include: { user: { select: { name: true } } } });
    const openReqs = await prisma.requirement.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' }, take: 10 });
    const reqNames = await prisma.user.findMany({ where: { id: { in: [...new Set(openReqs.map((r) => r.raisedById))] } }, select: { id: true, name: true } });
    const milestones = await prisma.milestoneEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
    const mNames = await prisma.user.findMany({ where: { id: { in: [...new Set(milestones.map((m) => m.userId))] } }, select: { id: true, name: true } });
    const items = await prisma.vaultItem.findMany({ where: { renewalDate: { not: null } } });
    const renewals = items.filter((i) => i.renewalDate! <= addDaysKey(today, 7)).map((i) => ({ id: i.id, name: i.name, renewalDate: i.renewalDate }));
    const reportsAwaiting = await prisma.dailyReport.count({ where: { dateKey: today, status: 'SUBMITTED', user: { managerId: me.id } } });
    const activity = await prisma.activityLog.findMany({ orderBy: { createdAt: 'desc' }, take: 12 });
    const aNames = await prisma.user.findMany({ where: { id: { in: [...new Set(activity.map((a) => a.actorId).filter(Boolean))] as string[] } }, select: { id: true, name: true } });

    payload.admin = {
      byDept, openAlerts,
      stipendsOverdue: overdue.map((o) => ({ id: o.id, name: o.user.name, amount: o.amount, dueDate: o.dueDate, kind: o.kind })),
      onLeaveToday: onLeaveToday.map((l) => ({ name: l.user.name, type: l.type })),
      requirements: openReqs.map((r) => ({ ...r, raisedByName: reqNames.find((n) => n.id === r.raisedById)?.name })),
      milestones: milestones.map((m) => ({ ...m, name: mNames.find((n) => n.id === m.userId)?.name })),
      renewals, reportsAwaiting,
      activity: activity.map((a) => ({ ...a, actorName: aNames.find((n) => n.id === a.actorId)?.name })),
      totalActive: users.length,
    };
  }

  res.json(payload);
});

export default router;
