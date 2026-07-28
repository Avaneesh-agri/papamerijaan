import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePrimaryAdmin, AuthedRequest, forbidden, clientIp } from '../middleware/auth';
import { loadOrg, subtreeIds } from '../lib/org';
import { logActivity } from '../lib/audit';
import { notify } from '../lib/notify';
import { getSettings } from '../lib/settings';
import { dayBounds, fmtIST, istDateTime, todayKey } from '../lib/time';

const router = Router();
router.use(requireAuth);

async function onLeaveOrHoliday(userId: string, dateKey: string) {
  const holiday = await prisma.holiday.findUnique({ where: { dateKey } });
  if (holiday) return { neutral: true, label: `Holiday — ${holiday.name}` };
  const leave = await prisma.leave.findFirst({ where: { userId, status: 'APPROVED', startDate: { lte: dateKey }, endDate: { gte: dateKey } } });
  if (leave) return { neutral: true, label: 'On leave' };
  return { neutral: false, label: null as string | null };
}

async function myDayTasks(userId: string, dateKey: string) {
  const { start, end } = dayBounds(dateKey);
  const assignments = await prisma.taskAssignee.findMany({
    where: { userId, task: { isRecurringTemplate: false, archived: false, dueAt: { gte: start, lt: end } } },
    include: { task: { select: { id: true, title: true, dueAt: true, priority: true } } },
  });
  return assignments.map((a) => ({
    taskId: a.task.id, title: a.task.title, dueAt: a.task.dueAt, priority: a.task.priority, status: a.status,
  }));
}

// ---------- MY REPORT ----------
router.get('/my', async (req: AuthedRequest, res) => {
  const dateKey = String(req.query.date || todayKey());
  const settings = await getSettings();
  const report = await prisma.dailyReport.findUnique({
    where: { userId_dateKey: { userId: req.user.id, dateKey } },
    include: { attachments: true },
  });
  const tasks = await myDayTasks(req.user.id, dateKey);
  const off = await onLeaveOrHoliday(req.user.id, dateKey);
  res.json({ dateKey, report, tasks, eodTime: settings.eod_time, offDay: off });
});

router.post('/my', async (req: AuthedRequest, res) => {
  const b = req.body || {};
  const dateKey = String(b.date || todayKey());
  const settings = await getSettings();
  const deadline = istDateTime(dateKey, String(settings.eod_time || '20:00'));
  const now = new Date();
  const late = now > deadline;
  const tasks = await myDayTasks(req.user.id, dateKey);

  const existing = await prisma.dailyReport.findUnique({ where: { userId_dateKey: { userId: req.user.id, dateKey } } });
  if (existing && existing.status === 'FORWARDED') return res.status(400).json({ error: 'This report was already forwarded up the chain.' });

  const report = await prisma.dailyReport.upsert({
    where: { userId_dateKey: { userId: req.user.id, dateKey } },
    update: { summary: b.summary || null, blockers: b.blockers || null, status: 'SUBMITTED', submittedAt: now, late, taskSnapshot: tasks },
    create: { userId: req.user.id, dateKey, summary: b.summary || null, blockers: b.blockers || null, status: 'SUBMITTED', submittedAt: now, late, taskSnapshot: tasks },
  });
  const files = (b.fileIds || []) as { id: string; name: string }[];
  if (files.length) {
    await prisma.reportAttachment.createMany({ data: files.map((f) => ({ reportId: report.id, fileId: f.id, name: f.name || 'file' })) });
  }
  await logActivity({ actorId: req.user.id, type: 'REPORT_SUBMITTED', detail: `Submitted daily report for ${dateKey}${late ? ' (LATE)' : ''}`, ip: clientIp(req) });
  if (req.user.managerId) {
    await notify(req.user.managerId, {
      type: 'report', title: `${req.user.name} filed their daily report${late ? ' — LATE' : ''}`,
      body: dateKey, link: `/reports?tab=team&date=${dateKey}`, level: late ? 'ALERT' : 'NORMAL',
    });
  }
  res.json({ report, late });
});

// ---------- TEAM REVIEW (manager: direct reports side by side) ----------
router.get('/team', async (req: AuthedRequest, res) => {
  const dateKey = String(req.query.date || todayKey());
  const directs = await prisma.user.findMany({
    where: { managerId: req.user.id, OR: [{ status: 'ACTIVE' }, { status: 'EXITED', exitDate: { gte: dateKey } }] },
    select: { id: true, name: true, username: true, photoFileId: true },
  });
  const rows = [] as any[];
  for (const d of directs) {
    const report = await prisma.dailyReport.findUnique({
      where: { userId_dateKey: { userId: d.id, dateKey } },
      include: { attachments: true },
    });
    const off = await onLeaveOrHoliday(d.id, dateKey);
    const tasks = await myDayTasks(d.id, dateKey);
    rows.push({ user: d, report, offDay: off, tasks });
  }
  const settings = await getSettings();
  const myReport = await prisma.dailyReport.findUnique({ where: { userId_dateKey: { userId: req.user.id, dateKey } } });
  res.json({ dateKey, rows, eodTime: settings.eod_time, myReport });
});

router.post('/:id/review', async (req: AuthedRequest, res) => {
  const report = await prisma.dailyReport.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!report) return res.status(404).json({ error: 'Not found' });
  const isManager = report.user.managerId === req.user.id;
  if (!isManager && !req.user.isPrimaryAdmin) return forbidden(res, 'Only this person’s manager can review their report.');
  await prisma.dailyReport.update({
    where: { id: report.id },
    data: { status: report.status === 'FORWARDED' ? 'FORWARDED' : 'REVIEWED', reviewedById: req.user.id, managerComment: req.body?.comment || null },
  });
  await notify(report.userId, { type: 'report_review', title: `Your daily report (${report.dateKey}) was reviewed`, body: req.body?.comment || undefined, link: `/reports?date=${report.dateKey}` });
  await logActivity({ actorId: req.user.id, type: 'REPORT_REVIEWED', targetUserId: report.userId, detail: `Reviewed ${report.user.name}'s report for ${report.dateKey}` });
  res.json({ ok: true });
});

// ---------- COMPILE & FORWARD (rolls up the tree, level by level) ----------
router.post('/compile', async (req: AuthedRequest, res) => {
  const dateKey = String(req.body?.date || todayKey());
  const directs = await prisma.user.findMany({ where: { managerId: req.user.id, status: 'ACTIVE' }, select: { id: true, name: true } });
  if (!directs.length && !req.user.isPrimaryAdmin) return res.status(400).json({ error: 'You have no direct reports to compile.' });

  const teamReports = await prisma.dailyReport.findMany({ where: { dateKey, userId: { in: directs.map((d) => d.id) }, status: { not: 'DRAFT' } } });
  const settings = await getSettings();
  const deadline = istDateTime(dateKey, String(settings.eod_time || '20:00'));
  const now = new Date();

  // The manager's own report bundles the team roll-up
  const mine = await prisma.dailyReport.upsert({
    where: { userId_dateKey: { userId: req.user.id, dateKey } },
    update: {
      status: 'FORWARDED', forwardedAt: now, compiledTeam: teamReports.map((r) => r.id),
      summary: req.body?.summary !== undefined ? req.body.summary : undefined,
      submittedAt: undefined,
    },
    create: {
      userId: req.user.id, dateKey, summary: req.body?.summary || null, status: 'FORWARDED',
      submittedAt: now, late: now > deadline, forwardedAt: now, compiledTeam: teamReports.map((r) => r.id),
      taskSnapshot: await myDayTasks(req.user.id, dateKey),
    },
  });
  await logActivity({ actorId: req.user.id, type: 'REPORT_FORWARDED', detail: `Compiled & forwarded team report for ${dateKey} (${teamReports.length} reports)` });
  if (req.user.managerId) {
    await notify(req.user.managerId, {
      type: 'report', title: `${req.user.name} forwarded their team's report`,
      body: `${dateKey} — ${teamReports.length} team member reports included`, link: `/reports?tab=team&date=${dateKey}`,
    });
  }
  res.json({ report: mine, included: teamReports.length });
});

// ---------- COMPANY DAY DATA (used by day view, PDF, CSV) ----------
async function buildDayData(dateKey: string) {
  const { start, end } = dayBounds(dateKey);
  const org = await loadOrg();
  const users = await prisma.user.findMany({ orderBy: { name: 'asc' } });
  const admin = users.find((u) => u.isPrimaryAdmin);

  // Branch = each direct report of the Primary Admin (their subtree). Admin themself = "Head Office".
  const branches: { label: string; rootId: string | null; userIds: string[] }[] = [];
  if (admin) {
    const roots = users.filter((u) => u.managerId === admin.id);
    for (const r of roots) {
      const ids = [...subtreeIds(org, r.id)];
      branches.push({ label: r.department ? `${r.department} — ${r.name}` : r.name, rootId: r.id, userIds: ids });
    }
    branches.push({ label: 'Head Office', rootId: admin.id, userIds: [admin.id] });
    const covered = new Set(branches.flatMap((b) => b.userIds));
    const rest = users.filter((u) => !covered.has(u.id)).map((u) => u.id);
    if (rest.length) branches.push({ label: 'Other', rootId: null, userIds: rest });
  }

  const assignedToday = await prisma.task.findMany({
    where: { isRecurringTemplate: false, createdAt: { gte: start, lt: end } },
    include: { assignees: { include: { user: { select: { id: true, name: true } } } } },
  });
  const dueToday = await prisma.task.findMany({
    where: { isRecurringTemplate: false, dueAt: { gte: start, lt: end } },
    include: { assignees: { include: { user: { select: { id: true, name: true } } } } },
  });
  const submissionsToday = await prisma.submission.findMany({
    where: { submittedAt: { gte: start, lt: end } },
    include: { task: { select: { id: true, title: true } }, user: { select: { id: true, name: true } }, files: true },
  });
  const reports = await prisma.dailyReport.findMany({
    where: { dateKey, status: { not: 'DRAFT' } },
    include: { user: { select: { id: true, name: true } }, attachments: true },
  });
  const openAlerts = await prisma.query.findMany({
    where: { level: 'ALERT', status: { not: 'RESOLVED' } },
    include: { messages: false },
  });
  const alertNames = await prisma.user.findMany({
    where: { id: { in: [...new Set(openAlerts.flatMap((q) => [q.raisedById, q.assignedToId]))] } },
    select: { id: true, name: true },
  });
  const leaves = await prisma.leave.findMany({
    where: { status: 'APPROVED', startDate: { lte: dateKey }, endDate: { gte: dateKey } },
    include: { user: { select: { id: true, name: true } } },
  });
  const holiday = await prisma.holiday.findUnique({ where: { dateKey } });
  const streakDays = await prisma.streakDay.findMany({ where: { dateKey }, include: { user: { select: { id: true, name: true } } } });

  // per-branch counters
  const perBranch = branches.map((b) => {
    const set = new Set(b.userIds);
    const bAssigned = assignedToday.filter((t) => t.assignees.some((a) => set.has(a.userId)));
    const bDue = dueToday.filter((t) => t.assignees.some((a) => set.has(a.userId)));
    const done = bDue.filter((t) => t.assignees.every((a) => !set.has(a.userId) || ['SUBMITTED', 'APPROVED'].includes(a.status)));
    const late = bDue.filter((t) => t.dueAt && new Date(t.dueAt) < new Date() && t.assignees.some((a) => set.has(a.userId) && !['SUBMITTED', 'APPROVED'].includes(a.status)));
    return {
      label: b.label, userIds: b.userIds,
      counts: { assigned: bAssigned.length, due: bDue.length, done: done.length, pending: bDue.length - done.length, late: late.length },
      assignedTasks: bAssigned, dueTasks: bDue,
    };
  });

  return {
    dateKey, holiday, users, branches: perBranch, assignedToday, dueToday, submissionsToday, reports,
    openAlerts: openAlerts.map((q) => ({ ...q, raisedByName: alertNames.find((n) => n.id === q.raisedById)?.name, holderName: alertNames.find((n) => n.id === q.assignedToId)?.name })),
    leaves, streakDays,
  };
}

// ---------- PRIMARY ADMIN DAY VIEW ----------
router.get('/day', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const dateKey = String(req.query.date || todayKey());
  const data = await buildDayData(dateKey);
  res.json({
    dateKey,
    holiday: data.holiday,
    branches: data.branches.map((b) => ({ label: b.label, counts: b.counts })),
    assignedToday: data.assignedToday.map((t) => ({ id: t.id, title: t.title, priority: t.priority, dueAt: t.dueAt, assignees: t.assignees.map((a) => ({ name: a.user.name, status: a.status })) })),
    dueToday: data.dueToday.map((t) => ({ id: t.id, title: t.title, priority: t.priority, dueAt: t.dueAt, assignees: t.assignees.map((a) => ({ name: a.user.name, status: a.status })) })),
    submissions: data.submissionsToday.map((s) => ({ id: s.id, task: s.task, user: s.user, submittedAt: s.submittedAt, files: s.files.map((f) => f.name) })),
    reports: data.reports,
    openAlerts: data.openAlerts,
    leaves: data.leaves.map((l) => ({ user: l.user, type: l.type })),
    streakDays: data.streakDays,
  });
});

// ---------- DAY REPORT PDF (multi-page, archived, re-downloadable) ----------
router.get('/day-pdf', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const dateKey = String(req.query.date || todayKey());
  const regenerate = req.query.regenerate === '1';

  const existing = await prisma.dayReportArchive.findUnique({ where: { dateKey } });
  if (existing && !regenerate) {
    const f = await prisma.fileObject.findUnique({ where: { id: existing.fileId } });
    if (f) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Asscher-AI-Day-Report-${dateKey}.pdf"`);
      return res.send(Buffer.from(f.data));
    }
  }

  const settings = await getSettings();
  const data = await buildDayData(dateKey);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 54, left: 50, right: 50 } });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const donePdf = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const H = (t: string) => doc.moveDown(0.8).fontSize(14).fillColor('#0f766e').text(t).moveDown(0.3).fontSize(10).fillColor('#111827');
  const line = () => doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e5e7eb').stroke().moveDown(0.4);

  // Cover page
  doc.fontSize(26).fillColor('#0f766e').text(String(settings.company_name || 'Asscher AI'), { align: 'center' });
  doc.moveDown(0.5).fontSize(16).fillColor('#111827').text('Daily Operations Report', { align: 'center' });
  doc.moveDown(0.3).fontSize(13).fillColor('#374151').text(fmtIST(istDateTime(dateKey, '12:00'), 'dddd, DD MMMM YYYY'), { align: 'center' });
  if (data.holiday) doc.moveDown(0.3).fontSize(11).fillColor('#b91c1c').text(`Company holiday: ${data.holiday.name}`, { align: 'center' });
  const totals = data.branches.reduce((acc, b) => ({ assigned: acc.assigned + b.counts.assigned, due: acc.due + b.counts.due, done: acc.done + b.counts.done, late: acc.late + b.counts.late }), { assigned: 0, due: 0, done: 0, late: 0 });
  doc.moveDown(2).fontSize(11).fillColor('#111827');
  doc.text(`Tasks assigned today: ${totals.assigned}`, { align: 'center' });
  doc.text(`Tasks due today: ${totals.due}   ·   Completed: ${totals.done}   ·   Late: ${totals.late}`, { align: 'center' });
  doc.text(`Open 🔴 alerts: ${data.openAlerts.length}   ·   On leave: ${data.leaves.length}`, { align: 'center' });
  doc.moveDown(2).fontSize(9).fillColor('#6b7280').text(`Generated ${fmtIST(new Date())} IST · Asscher AI Operations Platform`, { align: 'center' });

  // Per branch
  for (const b of data.branches) {
    doc.addPage();
    doc.fontSize(18).fillColor('#0f766e').text(b.label);
    doc.fontSize(10).fillColor('#374151').text(`Assigned: ${b.counts.assigned} · Due: ${b.counts.due} · Done: ${b.counts.done} · Pending: ${b.counts.pending} · Late: ${b.counts.late}`);
    line();
    H('Tasks assigned today');
    if (!b.assignedTasks.length) doc.fillColor('#6b7280').text('None');
    for (const t of b.assignedTasks) {
      doc.fillColor('#111827').text(`• ${t.title}  [${t.priority}]${t.dueAt ? ` — due ${fmtIST(t.dueAt)}` : ''}`);
      doc.fillColor('#6b7280').text(`   ${t.assignees.map((a: any) => `${a.user.name}: ${a.status}`).join(' · ')}`);
    }
    H('Tasks due today');
    if (!b.dueTasks.length) doc.fillColor('#6b7280').text('None');
    for (const t of b.dueTasks) {
      doc.fillColor('#111827').text(`• ${t.title}  [${t.priority}]${t.dueAt ? ` — due ${fmtIST(t.dueAt, 'h:mm A')}` : ''}`);
      doc.fillColor('#6b7280').text(`   ${t.assignees.map((a: any) => `${a.user.name}: ${a.status}`).join(' · ')}`);
    }
    const set = new Set(b.userIds);
    const subs = data.submissionsToday.filter((s) => set.has(s.user.id));
    H('Submissions today');
    if (!subs.length) doc.fillColor('#6b7280').text('None');
    for (const s of subs) {
      doc.fillColor('#111827').text(`• ${s.user.name} → ${s.task.title} at ${fmtIST(s.submittedAt, 'h:mm A')}`);
      if (s.content) doc.fillColor('#374151').text(`   "${String(s.content).slice(0, 250)}"`);
      if (s.files.length) doc.fillColor('#6b7280').text(`   Files: ${s.files.map((f) => f.name).join(', ')}`);
      if (s.linkUrl) doc.fillColor('#6b7280').text(`   Link: ${s.linkUrl}`);
    }
    const reps = data.reports.filter((r) => set.has(r.user.id));
    H('Daily report summaries');
    if (!reps.length) doc.fillColor('#6b7280').text('None submitted');
    for (const r of reps) {
      doc.fillColor('#111827').text(`• ${r.user.name} — ${r.late ? 'LATE' : 'on time'}${r.status === 'FORWARDED' ? ' · forwarded team roll-up' : ''}`);
      if (r.summary) doc.fillColor('#374151').text(`   ${String(r.summary).slice(0, 400)}`);
      if (r.blockers) doc.fillColor('#b91c1c').text(`   Blockers: ${String(r.blockers).slice(0, 200)}`);
      if (r.attachments.length) doc.fillColor('#6b7280').text(`   Attachments: ${r.attachments.map((a) => a.name).join(', ')}`);
    }
  }

  // Company-wide closing sections
  doc.addPage();
  doc.fontSize(18).fillColor('#0f766e').text('Company-wide');
  line();
  H('Late items');
  const lateTasks = data.dueToday.filter((t) => t.dueAt && new Date(t.dueAt) < new Date() && t.assignees.some((a) => !['SUBMITTED', 'APPROVED'].includes(a.status)));
  if (!lateTasks.length) doc.fillColor('#6b7280').text('None 🎉');
  for (const t of lateTasks) doc.fillColor('#b91c1c').text(`• ${t.title} — ${t.assignees.filter((a) => !['SUBMITTED', 'APPROVED'].includes(a.status)).map((a) => a.user.name).join(', ')}`);
  H('Open 🔴 alerts');
  if (!data.openAlerts.length) doc.fillColor('#6b7280').text('None');
  for (const q of data.openAlerts) doc.fillColor('#b91c1c').text(`• ${q.title} — raised by ${q.raisedByName}, with ${q.holderName}`);
  H('On leave / holiday');
  if (data.holiday) doc.fillColor('#111827').text(`Company holiday: ${data.holiday.name}`);
  if (!data.leaves.length && !data.holiday) doc.fillColor('#6b7280').text('Everyone present');
  for (const l of data.leaves) doc.fillColor('#111827').text(`• ${l.user.name} (${l.type})`);
  H('Streak movements');
  const counted = data.streakDays.filter((s) => s.result === 'COUNTED').length;
  const broke = data.streakDays.filter((s) => s.result === 'BROKE');
  doc.fillColor('#111827').text(`${counted} people kept their streak alive.`);
  for (const s of broke) doc.fillColor('#b91c1c').text(`• ${s.user.name}'s streak reset (${s.reason || 'missed/late work'})`);

  doc.end();
  const pdf = await donePdf;

  // Auto-save to the Day Report Archive (re-downloadable forever)
  const file = await prisma.fileObject.create({
    data: { name: `Asscher-AI-Day-Report-${dateKey}.pdf`, mime: 'application/pdf', size: pdf.length, data: new Uint8Array(pdf), uploadedById: req.user.id, scope: 'ARCHIVE' },
  });
  await prisma.dayReportArchive.upsert({
    where: { dateKey },
    update: { fileId: file.id, generatedById: req.user.id, generatedAt: new Date() },
    create: { dateKey, fileId: file.id, generatedById: req.user.id },
  });
  await logActivity({ actorId: req.user.id, type: 'DAY_PDF_GENERATED', detail: `Generated Day Report PDF for ${dateKey}`, ip: clientIp(req) });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Asscher-AI-Day-Report-${dateKey}.pdf"`);
  res.send(pdf);
});

router.get('/archive', requirePrimaryAdmin, async (_req: AuthedRequest, res) => {
  const items = await prisma.dayReportArchive.findMany({ orderBy: { dateKey: 'desc' }, take: 200 });
  res.json({ items });
});

// ---------- CSV ----------
router.get('/day-csv', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const dateKey = String(req.query.date || todayKey());
  const data = await buildDayData(dateKey);
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Branch', 'Task', 'Priority', 'Due', 'Assignee', 'Status'].join(',')];
  for (const b of data.branches) {
    for (const t of b.dueTasks) for (const a of t.assignees) rows.push([b.label, t.title, t.priority, t.dueAt ? fmtIST(t.dueAt) : '', a.user.name, a.status].map(esc).join(','));
  }
  rows.push('');
  rows.push(['Person', 'Report status', 'Late', 'Summary'].join(','));
  for (const r of data.reports) rows.push([r.user.name, r.status, r.late ? 'LATE' : 'on time', r.summary || ''].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="Asscher-AI-Day-${dateKey}.csv"`);
  res.send(rows.join('\n'));
});

export default router;
