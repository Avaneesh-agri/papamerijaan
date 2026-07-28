import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePrimaryAdmin, AuthedRequest, forbidden, clientIp } from '../middleware/auth';
import { loadOrg, ancestorIds, subtreeIds, isHead } from '../lib/org';
import { logActivity } from '../lib/audit';
import { notify, primaryAdminId } from '../lib/notify';

const router = Router();
router.use(requireAuth);

async function canSeeQuery(actor: any, q: any) {
  if (actor.isPrimaryAdmin) return true;
  if (q.raisedById === actor.id || q.assignedToId === actor.id) return true;
  const org = await loadOrg();
  const scope = subtreeIds(org, actor.id);
  return scope.has(q.raisedById) || scope.has(q.assignedToId);
}

// ---------- LIST ----------
router.get('/', async (req: AuthedRequest, res) => {
  const filter = String(req.query.filter || 'all'); // mine | assigned | later | team | all
  const org = await loadOrg();
  const scope = req.user.isPrimaryAdmin ? null : subtreeIds(org, req.user.id);
  const where: any = {};
  if (filter === 'mine') where.raisedById = req.user.id;
  else if (filter === 'assigned') { where.assignedToId = req.user.id; where.status = { not: 'RESOLVED' }; }
  else if (filter === 'later') { where.assignedToId = req.user.id; where.status = 'PARKED'; }
  else if (scope) where.OR = [{ raisedById: { in: [...scope] } }, { assignedToId: { in: [...scope] } }, { raisedById: req.user.id }, { assignedToId: req.user.id }];

  const queries = await prisma.query.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 300 });
  const uids = [...new Set(queries.flatMap((q) => [q.raisedById, q.assignedToId]))];
  const users = await prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true } });
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  // 🔴 Alerts pinned to top everywhere until resolved
  queries.sort((a, b) => {
    const aAlert = a.level === 'ALERT' && a.status !== 'RESOLVED' ? 0 : 1;
    const bAlert = b.level === 'ALERT' && b.status !== 'RESOLVED' ? 0 : 1;
    return aAlert - bAlert || +new Date(b.updatedAt) - +new Date(a.updatedAt);
  });
  res.json({ queries: queries.map((q) => ({ ...q, raisedByName: names[q.raisedById], holderName: names[q.assignedToId] })) });
});

// ---------- RAISE (always goes to the raiser's direct manager first) ----------
router.post('/', async (req: AuthedRequest, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'Give the query a title.' });
  if (!req.user.managerId) return res.status(400).json({ error: 'You have no manager to raise a query to.' });
  const level = ['ALERT', 'NORMAL', 'LATER'].includes(b.level) ? b.level : 'NORMAL';
  const q = await prisma.query.create({
    data: {
      title: String(b.title).trim(), raisedById: req.user.id, taskId: b.taskId || null,
      assignedToId: req.user.managerId, level, status: level === 'LATER' ? 'PARKED' : 'OPEN',
    },
  });
  if (b.body) await prisma.queryMessage.create({ data: { queryId: q.id, authorId: req.user.id, body: String(b.body) } });
  await logActivity({ actorId: req.user.id, type: 'QUERY_RAISED', detail: `Raised ${level === 'ALERT' ? '🔴 ALERT ' : ''}query "${q.title}"`, meta: { queryId: q.id }, ip: clientIp(req) });
  await notify(req.user.managerId, {
    type: level === 'ALERT' ? 'query_alert' : 'query',
    title: `${level === 'ALERT' ? '🔴 ALERT — ' : ''}${req.user.name} raised: ${q.title}`,
    link: `/queries/${q.id}`, level: level === 'ALERT' ? 'ALERT' : 'NORMAL',
  });
  res.json({ query: q });
});

// ---------- DETAIL (full escalation trail stays visible) ----------
router.get('/:id', async (req: AuthedRequest, res) => {
  const q = await prisma.query.findUnique({ where: { id: req.params.id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
  if (!q) return res.status(404).json({ error: 'Not found' });
  if (!(await canSeeQuery(req.user, q))) return forbidden(res);
  const uids = [...new Set([q.raisedById, q.assignedToId, ...q.messages.map((m) => m.authorId)])];
  const users = await prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true, username: true } });
  let task = null;
  if (q.taskId) task = await prisma.task.findUnique({ where: { id: q.taskId }, select: { id: true, title: true } });
  res.json({ query: q, users: Object.fromEntries(users.map((u) => [u.id, u])), task, canAct: q.assignedToId === req.user.id || req.user.isPrimaryAdmin });
});

// ---------- THREAD MESSAGE ----------
router.post('/:id/messages', async (req: AuthedRequest, res) => {
  const q = await prisma.query.findUnique({ where: { id: req.params.id } });
  if (!q) return res.status(404).json({ error: 'Not found' });
  if (!(await canSeeQuery(req.user, q))) return forbidden(res);
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message cannot be empty.' });
  const m = await prisma.queryMessage.create({ data: { queryId: q.id, authorId: req.user.id, body } });
  await prisma.query.update({ where: { id: q.id }, data: { updatedAt: new Date() } });
  const other = req.user.id === q.raisedById ? q.assignedToId : q.raisedById;
  await notify(other, { type: 'query', title: `${req.user.name} replied on "${q.title}"`, body: body.slice(0, 140), link: `/queries/${q.id}`, level: q.level === 'ALERT' ? 'ALERT' : 'NORMAL' });
  res.json({ message: m });
});

// ---------- ACTIONS: Answer / Park / Escalate / Resolve ----------
router.post('/:id/action', async (req: AuthedRequest, res) => {
  const q = await prisma.query.findUnique({ where: { id: req.params.id } });
  if (!q) return res.status(404).json({ error: 'Not found' });
  const { action, note } = req.body || {};
  const isHolder = q.assignedToId === req.user.id || req.user.isPrimaryAdmin;
  if (!isHolder) return forbidden(res, 'Only the person this query is currently with can act on it.');

  if (action === 'ANSWER') {
    if (!String(note || '').trim()) return res.status(400).json({ error: 'Write the answer.' });
    await prisma.queryMessage.create({ data: { queryId: q.id, authorId: req.user.id, kind: 'ANSWER', body: note } });
    await prisma.query.update({ where: { id: q.id }, data: { status: 'OPEN', updatedAt: new Date() } });
    await notify(q.raisedById, { type: 'query', title: `Answer on "${q.title}"`, body: String(note).slice(0, 140), link: `/queries/${q.id}` });
    await logActivity({ actorId: req.user.id, type: 'QUERY_ANSWERED', detail: `Answered query "${q.title}"` });
  } else if (action === 'PARK') {
    await prisma.queryMessage.create({ data: { queryId: q.id, authorId: req.user.id, kind: 'PARK', body: note || 'Parked for later' } });
    await prisma.query.update({ where: { id: q.id }, data: { status: 'PARKED', updatedAt: new Date() } });
    await notify(q.raisedById, { type: 'query', title: `"${q.title}" was parked in the Solve-later bucket`, link: `/queries/${q.id}` });
    await logActivity({ actorId: req.user.id, type: 'QUERY_PARKED', detail: `Parked query "${q.title}"` });
  } else if (action === 'REVIVE') {
    await prisma.query.update({ where: { id: q.id }, data: { status: 'OPEN', updatedAt: new Date() } });
    await logActivity({ actorId: req.user.id, type: 'QUERY_REVIVED', detail: `Revived query "${q.title}"` });
  } else if (action === 'ESCALATE') {
    const holder = await prisma.user.findUnique({ where: { id: q.assignedToId } });
    const nextId = holder?.managerId;
    if (!nextId) return res.status(400).json({ error: 'There is nobody above to escalate to — this is already at the top.' });
    const nextUser = await prisma.user.findUnique({ where: { id: nextId }, select: { name: true } });
    await prisma.queryMessage.create({
      data: { queryId: q.id, authorId: req.user.id, kind: 'ESCALATE', body: note || 'Escalated one level up', meta: { fromId: q.assignedToId, toId: nextId, fromName: holder?.name, toName: nextUser?.name } },
    });
    await prisma.query.update({ where: { id: q.id }, data: { assignedToId: nextId, status: 'OPEN', escalations: { increment: 1 }, updatedAt: new Date() } });
    await notify(nextId, {
      type: q.level === 'ALERT' ? 'query_alert' : 'query_escalated',
      title: `${q.level === 'ALERT' ? '🔴 ' : ''}Escalated to you: ${q.title}`,
      body: `From ${holder?.name}`, link: `/queries/${q.id}`, level: q.level === 'ALERT' ? 'ALERT' : 'NORMAL',
    });
    await notify(q.raisedById, { type: 'query', title: `"${q.title}" was escalated to ${nextUser?.name}`, link: `/queries/${q.id}` });
    await logActivity({ actorId: req.user.id, type: 'QUERY_ESCALATED', detail: `Escalated "${q.title}" to ${nextUser?.name}` });
  } else if (action === 'RESOLVE') {
    if (!String(note || '').trim()) return res.status(400).json({ error: 'A resolution note is required to close a query.' });
    await prisma.queryMessage.create({ data: { queryId: q.id, authorId: req.user.id, kind: 'RESOLVE', body: note } });
    await prisma.query.update({ where: { id: q.id }, data: { status: 'RESOLVED', resolutionNote: note, resolvedById: req.user.id, resolvedAt: new Date(), updatedAt: new Date() } });
    await notify(q.raisedById, { type: 'query', title: `✅ Resolved: ${q.title}`, body: String(note).slice(0, 140), link: `/queries/${q.id}` });
    await logActivity({ actorId: req.user.id, type: 'QUERY_RESOLVED', detail: `Resolved query "${q.title}"` });
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }
  res.json({ ok: true });
});

// ============================================================ REQUIREMENTS
// Only heads (users with reports) raise these; addressed to the Primary Admin.

router.get('/requirements/list', async (req: AuthedRequest, res) => {
  const where = req.user.isPrimaryAdmin ? {} : { raisedById: req.user.id };
  const items = await prisma.requirement.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  const uids = [...new Set(items.map((r) => r.raisedById))];
  const users = await prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true, department: true } });
  res.json({ requirements: items, users: Object.fromEntries(users.map((u) => [u.id, u])) });
});

router.post('/requirements', async (req: AuthedRequest, res) => {
  const org = await loadOrg();
  if (!req.user.isPrimaryAdmin && !isHead(org, req.user.id)) return forbidden(res, 'Only heads can raise Requirements to the Primary Admin.');
  const { title, detail } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title required.' });
  const r = await prisma.requirement.create({ data: { raisedById: req.user.id, title: String(title).trim(), detail: detail || null } });
  const adminId = await primaryAdminId();
  if (adminId && adminId !== req.user.id) {
    await notify(adminId, { type: 'requirement', title: `Requirement from ${req.user.name}: ${r.title}`, link: `/queries?tab=requirements` });
  }
  await logActivity({ actorId: req.user.id, type: 'REQUIREMENT_RAISED', detail: `Raised requirement "${r.title}"`, ip: clientIp(req) });
  res.json({ requirement: r });
});

// One click: Requirement → pre-filled task (the day's directive)
router.post('/requirements/:id/convert', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const r = await prisma.requirement.findUnique({ where: { id: req.params.id } });
  if (!r) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const assignees: string[] = b.assigneeIds?.length ? b.assigneeIds : [r.raisedById];
  const task = await prisma.task.create({
    data: {
      title: b.title || r.title, description: b.description || r.detail || `Converted from requirement raised by head.`,
      priority: b.priority || 'NORMAL', createdById: req.user.id,
      dueAt: b.dueAt ? new Date(b.dueAt) : null, submissionMethod: b.submissionMethod || 'TEXT',
    },
  });
  await prisma.taskAssignee.createMany({ data: assignees.map((uid) => ({ taskId: task.id, userId: uid, assignedById: req.user.id })) });
  await prisma.taskHistory.create({ data: { taskId: task.id, actorId: req.user.id, action: 'CREATED', detail: { fromRequirement: r.id } } });
  await prisma.requirement.update({ where: { id: r.id }, data: { status: 'CONVERTED', convertedTaskId: task.id } });
  await notify(assignees, { type: 'task_assigned', title: `New directive: ${task.title}`, link: `/tasks/${task.id}` });
  await notify(r.raisedById, { type: 'requirement', title: `Your requirement "${r.title}" became a task`, link: `/tasks/${task.id}` });
  await logActivity({ actorId: req.user.id, type: 'REQUIREMENT_CONVERTED', detail: `Converted requirement "${r.title}" into a task` });
  res.json({ taskId: task.id });
});

router.post('/requirements/:id/decide', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const { status, note } = req.body || {};
  if (!['DECLINED', 'DONE'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const r = await prisma.requirement.update({ where: { id: req.params.id }, data: { status, decisionNote: note || null } });
  await notify(r.raisedById, { type: 'requirement', title: `Requirement "${r.title}": ${status.toLowerCase()}`, body: note || undefined });
  await logActivity({ actorId: req.user.id, type: 'REQUIREMENT_DECIDED', detail: `${status} requirement "${r.title}"` });
  res.json({ requirement: r });
});

export default router;
