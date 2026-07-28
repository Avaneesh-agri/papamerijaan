import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePrimaryAdmin, AuthedRequest, forbidden, clientIp } from '../middleware/auth';
import { getScope, loadOrg, subtreeIds } from '../lib/org';
import { logActivity } from '../lib/audit';
import { notify, primaryAdminId } from '../lib/notify';
import { todayKey, monthOfKey, addDaysKey } from '../lib/time';

const router = Router();
router.use(requireAuth);

// ============================================================ STIPENDS

/** Auto-generate this month's due records for everyone with a stipend (idempotent). */
export async function ensureStipendRecords() {
  const month = monthOfKey(todayKey());
  const users = await prisma.user.findMany({ where: { status: 'ACTIVE', stipendAmount: { not: null, gt: 0 } } });
  for (const u of users) {
    const day = String(Math.min(Math.max(u.payDay || 5, 1), 28)).padStart(2, '0');
    await prisma.stipendRecord.upsert({
      where: { userId_periodKey_kind: { userId: u.id, periodKey: month, kind: 'STIPEND' } },
      update: {},
      create: { userId: u.id, periodKey: month, amount: u.stipendAmount!, dueDate: `${month}-${day}`, kind: 'STIPEND' },
    });
  }
}

router.get('/stipends', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  await ensureStipendRecords();
  const period = req.query.period ? String(req.query.period) : null;
  const records = await prisma.stipendRecord.findMany({
    where: period ? { periodKey: period } : {},
    include: { user: { select: { id: true, name: true, username: true, department: true, status: true } } },
    orderBy: [{ periodKey: 'desc' }, { dueDate: 'asc' }],
    take: 500,
  });
  const today = todayKey();
  res.json({
    records: records.map((r) => ({ ...r, overdue: !r.paidAt && r.dueDate < today })),
    overdueCount: records.filter((r) => !r.paidAt && r.dueDate < today).length,
  });
});

router.post('/stipends/:id/pay', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const r = await prisma.stipendRecord.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!r) return res.status(404).json({ error: 'Not found' });
  await prisma.stipendRecord.update({ where: { id: r.id }, data: { paidAt: new Date(), paidNote: req.body?.note || null } });
  await logActivity({ actorId: req.user.id, type: 'STIPEND_PAID', targetUserId: r.userId, detail: `Marked ₹${r.amount} ${r.kind.toLowerCase()} paid for ${r.user.name} (${r.periodKey})`, ip: clientIp(req) });
  await notify(r.userId, { type: 'stipend', title: `₹${r.amount.toLocaleString('en-IN')} ${r.kind === 'BONUS' ? 'bonus' : 'stipend'} marked paid`, body: req.body?.note || undefined });
  res.json({ ok: true });
});

// Manual bonus (e.g., streak bonus). The system only records — it never pays automatically.
router.post('/stipends/bonus', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const { userId, amount, note } = req.body || {};
  if (!userId || !amount) return res.status(400).json({ error: 'userId and amount required' });
  const month = monthOfKey(todayKey());
  const existing = await prisma.stipendRecord.findUnique({ where: { userId_periodKey_kind: { userId, periodKey: month, kind: 'BONUS' } } });
  const r = existing
    ? await prisma.stipendRecord.update({ where: { id: existing.id }, data: { amount: existing.amount + Number(amount), paidNote: note || existing.paidNote } })
    : await prisma.stipendRecord.create({ data: { userId, periodKey: month, kind: 'BONUS', amount: Number(amount), dueDate: todayKey(), paidNote: note || null, createdById: req.user.id } });
  await logActivity({ actorId: req.user.id, type: 'BONUS_ADDED', targetUserId: userId, detail: `Added ₹${amount} bonus (${note || 'no note'})` });
  res.json({ record: r });
});

router.get('/stipends/user/:id', async (req: AuthedRequest, res) => {
  if (!req.user.isPrimaryAdmin && req.user.id !== req.params.id) return forbidden(res);
  const records = await prisma.stipendRecord.findMany({ where: { userId: req.params.id }, orderBy: { periodKey: 'desc' } });
  res.json({ records });
});

// ============================================================ LEAVES

router.post('/leaves', async (req: AuthedRequest, res) => {
  const b = req.body || {};
  if (!b.startDate || !b.endDate) return res.status(400).json({ error: 'Pick the dates.' });
  if (b.endDate < b.startDate) return res.status(400).json({ error: 'End date is before start date.' });
  if (!req.user.managerId && !req.user.isPrimaryAdmin) return res.status(400).json({ error: 'You have no manager to send this to.' });
  const leave = await prisma.leave.create({
    data: {
      userId: req.user.id, type: ['CASUAL', 'SICK', 'OTHER'].includes(b.type) ? b.type : 'CASUAL',
      startDate: b.startDate, endDate: b.endDate, reason: b.reason || null, attachmentFileId: b.attachmentFileId || null,
      status: req.user.isPrimaryAdmin ? 'APPROVED' : 'PENDING',
      decidedById: req.user.isPrimaryAdmin ? req.user.id : null,
    },
  });
  await logActivity({ actorId: req.user.id, type: 'LEAVE_APPLIED', detail: `Applied for ${leave.type} leave ${b.startDate} → ${b.endDate}`, ip: clientIp(req) });
  if (req.user.managerId) {
    await notify(req.user.managerId, { type: 'leave', title: `${req.user.name} applied for leave`, body: `${b.startDate} → ${b.endDate} (${leave.type})`, link: `/leaves?tab=approvals` });
  }
  res.json({ leave });
});

router.get('/leaves', async (req: AuthedRequest, res) => {
  const tab = String(req.query.tab || 'mine');
  if (tab === 'mine') {
    const leaves = await prisma.leave.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } });
    return res.json({ leaves });
  }
  // approvals: pending from direct reports (admin: everyone) — admin can override any decision
  if (tab === 'approvals') {
    const where = req.user.isPrimaryAdmin ? {} : { user: { managerId: req.user.id } };
    const leaves = await prisma.leave.findMany({ where, include: { user: { select: { id: true, name: true, username: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return res.json({ leaves });
  }
  // calendar: approved leaves in subtree for a month
  const month = String(req.query.month || monthOfKey(todayKey()));
  const { ids } = await getScope(req.user);
  const leaves = await prisma.leave.findMany({
    where: { userId: { in: [...ids] }, status: 'APPROVED', startDate: { lte: `${month}-31` }, endDate: { gte: `${month}-01` } },
    include: { user: { select: { id: true, name: true } } },
  });
  const holidays = await prisma.holiday.findMany({ where: { dateKey: { gte: `${month}-01`, lte: `${month}-31` } } });
  res.json({ leaves, holidays, month });
});

router.post('/leaves/:id/decide', async (req: AuthedRequest, res) => {
  const leave = await prisma.leave.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!leave) return res.status(404).json({ error: 'Not found' });
  const isManager = leave.user.managerId === req.user.id;
  if (!isManager && !req.user.isPrimaryAdmin) return forbidden(res, 'Only this person’s manager (or the Primary Admin) can decide this leave.');
  const { decision, note } = req.body || {};
  if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'Invalid decision' });
  await prisma.leave.update({ where: { id: leave.id }, data: { status: decision, decidedById: req.user.id, decisionNote: note || null, decidedAt: new Date() } });
  await logActivity({ actorId: req.user.id, type: 'LEAVE_DECIDED', targetUserId: leave.userId, detail: `${decision === 'APPROVED' ? 'Approved' : 'Rejected'} ${leave.user.name}'s leave ${leave.startDate} → ${leave.endDate}${req.user.isPrimaryAdmin && !isManager ? ' (override)' : ''}` });
  await notify(leave.userId, { type: 'leave', title: `Leave ${decision.toLowerCase()}: ${leave.startDate} → ${leave.endDate}`, body: note || undefined, link: '/leaves' });
  res.json({ ok: true });
});

// ============================================================ HOLIDAYS (Primary Admin, company-wide)

router.get('/holidays', async (_req: AuthedRequest, res) => {
  const holidays = await prisma.holiday.findMany({ orderBy: { dateKey: 'asc' } });
  res.json({ holidays });
});

router.post('/holidays', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const { dateKey, name } = req.body || {};
  if (!dateKey || !name) return res.status(400).json({ error: 'Date and name required.' });
  const h = await prisma.holiday.upsert({ where: { dateKey }, update: { name }, create: { dateKey, name } });
  await logActivity({ actorId: req.user.id, type: 'HOLIDAY_SET', detail: `Set holiday ${dateKey}: ${name}` });
  res.json({ holiday: h });
});

router.delete('/holidays/:dateKey', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  await prisma.holiday.delete({ where: { dateKey: req.params.dateKey } }).catch(() => {});
  await logActivity({ actorId: req.user.id, type: 'HOLIDAY_REMOVED', detail: `Removed holiday ${req.params.dateKey}` });
  res.json({ ok: true });
});

export default router;
