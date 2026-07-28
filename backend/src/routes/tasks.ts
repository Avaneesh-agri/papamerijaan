import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthedRequest, forbidden, clientIp } from '../middleware/auth';
import { getScope, loadOrg, subtreeIds, ancestorIds } from '../lib/org';
import { logActivity } from '../lib/audit';
import { notify } from '../lib/notify';
import { dayBounds, fmtIST, todayKey } from '../lib/time';

const router = Router();
router.use(requireAuth);

// ---------- access helper: admin, creator, assignee, or ancestor-manager of an assignee/creator ----------
export async function canAccessTask(actor: any, taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { assignees: true } });
  if (!task) return { task: null, ok: false, why: 'missing' };
  if (actor.isPrimaryAdmin) return { task, ok: true };
  if (task.createdById === actor.id) return { task, ok: true };
  if (task.assignees.some((a) => a.userId === actor.id)) return { task, ok: true };
  const org = await loadOrg();
  const scope = subtreeIds(org, actor.id);
  if (scope.has(task.createdById)) return { task, ok: true };
  if (task.assignees.some((a) => scope.has(a.userId))) return { task, ok: true };
  return { task, ok: false };
}

function taskSummary(t: any) {
  return {
    id: t.id, title: t.title, priority: t.priority, dueAt: t.dueAt, startDate: t.startDate,
    submissionMethod: t.submissionMethod, parentTaskId: t.parentTaskId, createdById: t.createdById,
    isRecurringTemplate: t.isRecurringTemplate, recurrenceRule: t.recurrenceRule, createdAt: t.createdAt,
    assignees: (t.assignees || []).map((a: any) => ({
      userId: a.userId, name: a.user?.name, status: a.status, firstOpenedAt: a.firstOpenedAt,
    })),
  };
}

// ---------- LIST ----------
router.get('/', async (req: AuthedRequest, res) => {
  const scope = String(req.query.scope || 'mine'); // mine | created | team | templates
  const date = req.query.date ? String(req.query.date) : null;
  const status = req.query.status ? String(req.query.status) : null;
  const q = req.query.q ? String(req.query.q) : null;
  const { ids } = await getScope(req.user);

  const where: any = { archived: false, isRecurringTemplate: scope === 'templates' };
  if (scope === 'mine') where.assignees = { some: { userId: req.user.id, ...(status ? { status } : {}) } };
  else if (scope === 'created') where.createdById = req.user.id;
  else if (scope === 'team' || scope === 'templates') {
    where.OR = [{ assignees: { some: { userId: { in: [...ids] } } } }, { createdById: { in: [...ids] } }];
    if (status && scope === 'team') where.assignees = { some: { userId: { in: [...ids] }, status } };
  }
  if (date) {
    const { start, end } = dayBounds(date);
    where.dueAt = { gte: start, lt: end };
  }
  if (q) where.title = { contains: q, mode: 'insensitive' };

  const tasks = await prisma.task.findMany({
    where,
    include: { assignees: { include: { user: { select: { name: true } } } } },
    orderBy: [{ priority: 'asc' }, { dueAt: 'asc' }],
    take: 400,
  });
  // ALERT first, then HIGH, then NORMAL
  const rank: any = { ALERT: 0, HIGH: 1, NORMAL: 2 };
  tasks.sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3) || (a.dueAt && b.dueAt ? +new Date(a.dueAt) - +new Date(b.dueAt) : a.dueAt ? -1 : 1));
  res.json({ tasks: tasks.map(taskSummary) });
});

// ---------- CREATE (workers: self only; heads: own subtree; admin: anywhere) ----------
router.post('/', async (req: AuthedRequest, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'Title is required.' });
  const assigneeIds: string[] = [...new Set((b.assigneeIds || []) as string[])];
  if (!assigneeIds.length && !b.isRecurringTemplate) return res.status(400).json({ error: 'Pick at least one assignee.' });

  const { ids } = await getScope(req.user);
  for (const uid of assigneeIds) {
    if (!ids.has(uid)) return forbidden(res, 'You can only assign tasks within your own team (or to yourself).');
  }

  let parent: any = null;
  if (b.parentTaskId) {
    const acc = await canAccessTask(req.user, b.parentTaskId);
    if (!acc.ok) return forbidden(res, 'You do not have access to the parent task.');
    parent = acc.task;
  }

  const task = await prisma.task.create({
    data: {
      title: String(b.title).trim(),
      description: b.description || null,
      protocol: b.protocol || null,
      priority: ['NORMAL', 'HIGH', 'ALERT'].includes(b.priority) ? b.priority : 'NORMAL',
      createdById: req.user.id,
      parentTaskId: b.parentTaskId || null,
      startDate: b.startDate || null,
      dueAt: b.dueAt ? new Date(b.dueAt) : null,
      expectedEffort: b.expectedEffort || null,
      submissionMethod: ['TEXT', 'FILE', 'LINK', 'CHECKLIST'].includes(b.submissionMethod) ? b.submissionMethod : 'TEXT',
      checklistItems: b.checklistItems || undefined,
      isRecurringTemplate: !!b.isRecurringTemplate,
      recurrenceRule: b.recurrenceRule || undefined,
    },
  });

  if (assigneeIds.length) {
    await prisma.taskAssignee.createMany({ data: assigneeIds.map((uid) => ({ taskId: task.id, userId: uid, assignedById: req.user.id })) });
  }

  // Resources: uploaded files, external links, in-app library videos
  const resources: any[] = [];
  for (const f of b.fileIds || []) resources.push({ taskId: task.id, type: 'FILE', fileId: f.id || f, label: f.name || null });
  for (const l of b.links || []) if (l && l.url) resources.push({ taskId: task.id, type: 'LINK', url: l.url, label: l.label || l.url });
  for (const v of b.videoIds || []) resources.push({ taskId: task.id, type: 'VIDEO', videoId: v });
  if (resources.length) await prisma.taskResource.createMany({ data: resources });

  await prisma.taskHistory.create({ data: { taskId: task.id, actorId: req.user.id, action: 'CREATED', detail: { title: task.title, assignees: assigneeIds } } });
  await logActivity({ actorId: req.user.id, type: 'TASK_CREATED', detail: `Created task "${task.title}"`, meta: { taskId: task.id }, ip: clientIp(req) });

  const others = assigneeIds.filter((x) => x !== req.user.id);
  if (others.length) {
    await notify(others, {
      type: 'task_assigned',
      title: `New task: ${task.title}`,
      body: task.dueAt ? `Due ${fmtIST(task.dueAt)}` : undefined,
      link: `/tasks/${task.id}`,
      level: task.priority === 'ALERT' ? 'ALERT' : 'NORMAL',
    });
  }
  if (parent && parent.createdById !== req.user.id) {
    await notify(parent.createdById, { type: 'task_breakdown', title: `${req.user.name} broke down "${parent.title}"`, body: `Child task: ${task.title}`, link: `/tasks/${parent.id}` });
  }
  res.json({ task: { id: task.id } });
});

// ---------- DETAIL ----------
router.get('/:id', async (req: AuthedRequest, res) => {
  const acc = await canAccessTask(req.user, req.params.id);
  if (!acc.task) return res.status(404).json({ error: 'Task not found' });
  if (!acc.ok) return forbidden(res);
  const t = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: {
      assignees: { include: { user: { select: { id: true, name: true, username: true, photoFileId: true } } } },
      resources: true,
      comments: { orderBy: { createdAt: 'asc' } },
      history: { orderBy: { createdAt: 'asc' } },
      childTasks: { include: { assignees: { include: { user: { select: { name: true } } } } } },
      submissions: { include: { files: true }, orderBy: { submittedAt: 'asc' } },
      parentTask: { select: { id: true, title: true, createdById: true } },
    },
  });
  if (!t) return res.status(404).json({ error: 'Task not found' });

  // Scope what the requester may see of the task's surroundings
  const org = await loadOrg();
  const myScope = req.user.isPrimaryAdmin ? null : subtreeIds(org, req.user.id);
  const isAssignee = t.assignees.some((a) => a.userId === req.user.id);
  const canReview = req.user.isPrimaryAdmin || t.createdById === req.user.id || t.assignees.some((a) => myScope?.has(a.userId) && a.userId !== req.user.id);

  // Parent shown only if requester can access it too (a worker must not open the head's directive from above)
  let parentTask = null as any;
  if (t.parentTask) {
    const pacc = await canAccessTask(req.user, t.parentTask.id);
    parentTask = pacc.ok ? t.parentTask : { id: null, title: t.parentTask.title, restricted: true };
  }
  // Child tasks: only ones the requester can see
  const visibleChildren = [] as any[];
  for (const c of t.childTasks) {
    if (req.user.isPrimaryAdmin || c.createdById === req.user.id || c.assignees.some((a: any) => a.userId === req.user.id || myScope?.has(a.userId))) {
      visibleChildren.push(taskSummary(c));
    }
  }
  // Submissions: worker sees own; reviewers see all
  const submissions = t.submissions.filter((s) => canReview || s.userId === req.user.id);

  // author names for comments/history
  const uids = new Set<string>();
  t.comments.forEach((c) => uids.add(c.authorId));
  t.history.forEach((h) => uids.add(h.actorId));
  submissions.forEach((s) => { uids.add(s.userId); if (s.reviewedById) uids.add(s.reviewedById); });
  uids.add(t.createdById);
  const nameRows = await prisma.user.findMany({ where: { id: { in: [...uids] } }, select: { id: true, name: true, username: true } });
  const names = Object.fromEntries(nameRows.map((u) => [u.id, u]));

  // Video resources: expose ONLY id/title/category (never the Drive id/URL)
  const videoIds = t.resources.filter((r) => r.type === 'VIDEO' && r.videoId).map((r) => r.videoId!) as string[];
  const videos = videoIds.length
    ? await prisma.video.findMany({ where: { id: { in: videoIds } }, select: { id: true, title: true, category: true } })
    : [];
  const watched = videoIds.length
    ? await prisma.videoView.findMany({ where: { videoId: { in: videoIds }, userId: { in: t.assignees.map((a) => a.userId) } }, select: { videoId: true, userId: true } })
    : [];

  res.json({
    task: {
      ...t,
      submissions,
      childTasks: visibleChildren,
      parentTask,
      resources: t.resources.map((r) => (r.type === 'VIDEO' ? { ...r } : r)),
      videos,
      videoWatches: watched,
      names,
      canReview,
      isAssignee,
      canEdit: req.user.isPrimaryAdmin || t.createdById === req.user.id,
    },
  });
});

// ---------- EDIT (creator or Primary Admin only — a head can NEVER alter a directive from above) ----------
router.patch('/:id', async (req: AuthedRequest, res) => {
  const t = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (!req.user.isPrimaryAdmin && t.createdById !== req.user.id)
    return forbidden(res, 'Only the task’s creator (or the Primary Admin) can edit it. Add comments or child tasks instead — the original is never altered.');
  const b = req.body || {};
  const data: any = {};
  const changes: any = {};
  for (const f of ['title', 'description', 'protocol', 'priority', 'startDate', 'expectedEffort', 'submissionMethod'] as const) {
    if (b[f] !== undefined && b[f] !== (t as any)[f]) { data[f] = b[f]; changes[f] = { from: (t as any)[f], to: b[f] }; }
  }
  if (b.dueAt !== undefined) { data.dueAt = b.dueAt ? new Date(b.dueAt) : null; changes.dueAt = { from: t.dueAt, to: b.dueAt }; }
  if (b.checklistItems !== undefined) data.checklistItems = b.checklistItems;
  if (b.recurrenceRule !== undefined) data.recurrenceRule = b.recurrenceRule;
  if (b.archived !== undefined && req.user.isPrimaryAdmin) data.archived = !!b.archived;

  // add/remove assignees (within creator's scope)
  if (Array.isArray(b.addAssignees) && b.addAssignees.length) {
    const { ids } = await getScope(req.user);
    for (const uid of b.addAssignees) if (!ids.has(uid)) return forbidden(res, 'Assignees must be inside your own team.');
    for (const uid of b.addAssignees) {
      await prisma.taskAssignee.upsert({
        where: { taskId_userId: { taskId: t.id, userId: uid } }, update: {},
        create: { taskId: t.id, userId: uid, assignedById: req.user.id },
      });
      if (uid !== req.user.id) await notify(uid, { type: 'task_assigned', title: `New task: ${t.title}`, link: `/tasks/${t.id}` });
    }
    changes.addedAssignees = b.addAssignees;
  }
  const task = await prisma.task.update({ where: { id: t.id }, data });
  await prisma.taskHistory.create({ data: { taskId: t.id, actorId: req.user.id, action: 'EDITED', detail: changes } });
  await logActivity({ actorId: req.user.id, type: 'TASK_EDITED', detail: `Edited task "${t.title}"`, meta: { taskId: t.id, changes: Object.keys(changes) } });
  res.json({ task: { id: task.id } });
});

// ---------- OPEN (read receipt) ----------
router.post('/:id/open', async (req: AuthedRequest, res) => {
  const a = await prisma.taskAssignee.findUnique({ where: { taskId_userId: { taskId: req.params.id, userId: req.user.id } }, include: { task: true } });
  if (!a) return res.json({ ok: true }); // non-assignees just viewing
  if (!a.firstOpenedAt) {
    const now = new Date();
    await prisma.taskAssignee.update({
      where: { id: a.id },
      data: { firstOpenedAt: now, status: a.status === 'ASSIGNED' ? 'OPENED' : a.status, lastActivityAt: now },
    });
    await prisma.taskHistory.create({ data: { taskId: a.taskId, actorId: req.user.id, action: 'OPENED', detail: { at: now } } });
    await logActivity({ actorId: req.user.id, type: 'TASK_OPENED', detail: `Opened task "${a.task.title}"`, meta: { taskId: a.taskId } });
    if (a.assignedById !== req.user.id) {
      await notify(a.assignedById, { type: 'task_opened', title: `${req.user.name} opened "${a.task.title}"`, body: `Opened at ${fmtIST(now, 'h:mm A')}`, link: `/tasks/${a.taskId}` });
    }
  } else {
    await prisma.taskAssignee.update({ where: { id: a.id }, data: { lastActivityAt: new Date() } });
  }
  res.json({ ok: true });
});

// ---------- SELF STATUS (In Progress) ----------
router.post('/:id/status', async (req: AuthedRequest, res) => {
  const a = await prisma.taskAssignee.findUnique({ where: { taskId_userId: { taskId: req.params.id, userId: req.user.id } } });
  if (!a) return forbidden(res);
  const status = req.body?.status;
  if (!['IN_PROGRESS'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  await prisma.taskAssignee.update({ where: { id: a.id }, data: { status, lastActivityAt: new Date() } });
  res.json({ ok: true });
});

// ---------- SUBMIT ----------
router.post('/:id/submit', async (req: AuthedRequest, res) => {
  const a = await prisma.taskAssignee.findUnique({ where: { taskId_userId: { taskId: req.params.id, userId: req.user.id } }, include: { task: true } });
  if (!a) return forbidden(res, 'You are not an assignee of this task.');
  const b = req.body || {};
  const prev = await prisma.submission.count({ where: { taskId: a.taskId, userId: req.user.id } });
  const sub = await prisma.submission.create({
    data: {
      taskId: a.taskId, userId: req.user.id, attempt: prev + 1,
      content: b.content || null, linkUrl: b.linkUrl || null, checklistState: b.checklistState || undefined,
    },
  });
  const files = (b.fileIds || []) as { id: string; name: string }[];
  if (files.length) await prisma.submissionFile.createMany({ data: files.map((f) => ({ submissionId: sub.id, fileId: f.id, name: f.name || 'file' })) });
  await prisma.taskAssignee.update({ where: { id: a.id }, data: { status: 'SUBMITTED', lastActivityAt: new Date() } });
  await prisma.taskHistory.create({ data: { taskId: a.taskId, actorId: req.user.id, action: 'SUBMITTED', detail: { attempt: prev + 1 } } });
  await logActivity({ actorId: req.user.id, type: 'TASK_SUBMITTED', detail: `Submitted "${a.task.title}" (attempt ${prev + 1})`, meta: { taskId: a.taskId } });
  const late = a.task.dueAt && new Date() > new Date(a.task.dueAt);
  if (a.assignedById !== req.user.id) {
    await notify(a.assignedById, {
      type: 'submission', title: `${req.user.name} submitted "${a.task.title}"${late ? ' (LATE)' : ''}`,
      link: `/tasks/${a.taskId}`, level: late ? 'ALERT' : 'NORMAL',
    });
  }
  res.json({ submission: { id: sub.id }, late: !!late });
});

// ---------- REVIEW (assigner / creator / ancestor manager / admin) ----------
router.post('/:id/review', async (req: AuthedRequest, res) => {
  const { submissionId, result, note } = req.body || {};
  if (!['APPROVED', 'RETURNED'].includes(result)) return res.status(400).json({ error: 'Invalid result' });
  if (result === 'RETURNED' && !String(note || '').trim()) return res.status(400).json({ error: 'A note is mandatory when returning for rework.' });
  const sub = await prisma.submission.findUnique({ where: { id: submissionId }, include: { task: true } });
  if (!sub || sub.taskId !== req.params.id) return res.status(404).json({ error: 'Submission not found' });

  const org = await loadOrg();
  const allowed =
    req.user.isPrimaryAdmin ||
    sub.task.createdById === req.user.id ||
    ancestorIds(org, sub.userId).includes(req.user.id);
  if (!allowed) return forbidden(res, 'Only the assigner or a manager up the chain can review this.');

  await prisma.submission.update({
    where: { id: sub.id },
    data: { reviewStatus: result, reviewedById: req.user.id, reviewNote: note || null, reviewedAt: new Date() },
  });
  const a = await prisma.taskAssignee.findUnique({ where: { taskId_userId: { taskId: sub.taskId, userId: sub.userId } } });
  if (a) await prisma.taskAssignee.update({ where: { id: a.id }, data: { status: result === 'APPROVED' ? 'APPROVED' : 'RETURNED', lastActivityAt: new Date() } });
  await prisma.taskHistory.create({ data: { taskId: sub.taskId, actorId: req.user.id, action: result === 'APPROVED' ? 'APPROVED' : 'RETURNED', detail: { submissionId, note } } });
  await logActivity({ actorId: req.user.id, type: 'TASK_REVIEWED', targetUserId: sub.userId, detail: `${result === 'APPROVED' ? 'Approved' : 'Returned'} "${sub.task.title}"`, meta: { taskId: sub.taskId } });
  await notify(sub.userId, {
    type: 'review', title: `${result === 'APPROVED' ? '✅ Approved' : '↩ Returned for rework'}: ${sub.task.title}`,
    body: note || undefined, link: `/tasks/${sub.taskId}`, level: result === 'RETURNED' ? 'ALERT' : 'NORMAL',
  });
  res.json({ ok: true });
});

// ---------- COMMENTS with @mentions ----------
router.post('/:id/comments', async (req: AuthedRequest, res) => {
  const acc = await canAccessTask(req.user, req.params.id);
  if (!acc.ok || !acc.task) return forbidden(res);
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Comment cannot be empty.' });

  const usernames = [...body.matchAll(/@([a-z0-9._-]+)/gi)].map((m) => m[1].toLowerCase());
  const mentioned = usernames.length
    ? await prisma.user.findMany({ where: { username: { in: usernames } }, select: { id: true } })
    : [];
  const comment = await prisma.taskComment.create({
    data: { taskId: acc.task.id, authorId: req.user.id, body, mentions: mentioned.map((m) => m.id) },
  });
  const participants = new Set<string>([acc.task.createdById, ...acc.task.assignees.map((a: any) => a.userId), ...mentioned.map((m) => m.id)]);
  participants.delete(req.user.id);
  if (participants.size) {
    await notify([...participants], { type: 'comment', title: `${req.user.name} commented on "${acc.task.title}"`, body: body.slice(0, 140), link: `/tasks/${acc.task.id}` });
  }
  await logActivity({ actorId: req.user.id, type: 'TASK_COMMENT', detail: `Commented on "${acc.task.title}"`, meta: { taskId: acc.task.id } });
  res.json({ comment });
});

// ---------- PROTOCOL TEMPLATES ----------
router.get('/templates/protocols', async (_req: AuthedRequest, res) => {
  const templates = await prisma.protocolTemplate.findMany({ orderBy: { title: 'asc' } });
  res.json({ templates });
});
router.post('/templates/protocols', async (req: AuthedRequest, res) => {
  const { title, body } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'Title and body required.' });
  const t = await prisma.protocolTemplate.create({ data: { title, body, createdById: req.user.id } });
  res.json({ template: t });
});
router.delete('/templates/protocols/:tid', async (req: AuthedRequest, res) => {
  const t = await prisma.protocolTemplate.findUnique({ where: { id: req.params.tid } });
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (!req.user.isPrimaryAdmin && t.createdById !== req.user.id) return forbidden(res);
  await prisma.protocolTemplate.delete({ where: { id: t.id } });
  res.json({ ok: true });
});

export default router;
