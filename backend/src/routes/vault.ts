import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePrimaryAdmin, AuthedRequest, forbidden, clientIp } from '../middleware/auth';
import { encryptSecret, decryptSecret } from '../lib/crypto';
import { logActivity } from '../lib/audit';
import { todayKey, addDaysKey } from '../lib/time';

const router = Router();
router.use(requireAuth);

function maskItem(item: any, canSee: boolean) {
  return {
    id: item.id, name: item.name, plan: item.plan, monthlyCost: item.monthlyCost, renewalDate: item.renewalDate,
    loginEmail: item.loginEmail, loginUsername: item.loginUsername,
    hasPassword: !!item.passwordEnc, // masked by default — reveal-on-click only, logged
    otpPhone: item.otpPhone, otpHolder: item.otpHolder, recoveryEmail: item.recoveryEmail, notes: item.notes,
    sharedWith: canSee ? item.access?.map((a: any) => ({ userId: a.userId, name: a.user?.name })) : undefined,
  };
}

// ---------- ITEMS: Primary Admin full; others only items explicitly shared with them ----------
router.get('/items', async (req: AuthedRequest, res) => {
  if (req.user.isPrimaryAdmin) {
    const items = await prisma.vaultItem.findMany({ include: { access: { include: { user: { select: { name: true } } } } }, orderBy: { name: 'asc' } });
    return res.json({ items: items.map((i) => maskItem(i, true)), full: true });
  }
  const access = await prisma.vaultAccess.findMany({ where: { userId: req.user.id }, include: { item: true } });
  res.json({ items: access.map((a) => maskItem(a.item, false)), full: false });
});

router.post('/items', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name required.' });
  const item = await prisma.vaultItem.create({
    data: {
      name: b.name, plan: b.plan || null, monthlyCost: b.monthlyCost ? Number(b.monthlyCost) : null,
      renewalDate: b.renewalDate || null, loginEmail: b.loginEmail || null, loginUsername: b.loginUsername || null,
      passwordEnc: b.password ? encryptSecret(String(b.password)) : null,
      otpPhone: b.otpPhone || null, otpHolder: b.otpHolder || null, recoveryEmail: b.recoveryEmail || null, notes: b.notes || null,
    },
  });
  await logActivity({ actorId: req.user.id, type: 'VAULT_ITEM_CREATED', detail: `Added vault item "${item.name}"`, ip: clientIp(req) });
  res.json({ item: maskItem(item, true) });
});

router.patch('/items/:id', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const b = req.body || {};
  const data: any = {};
  for (const f of ['name', 'plan', 'renewalDate', 'loginEmail', 'loginUsername', 'otpPhone', 'otpHolder', 'recoveryEmail', 'notes'] as const) {
    if (b[f] !== undefined) data[f] = b[f] || null;
  }
  if (b.monthlyCost !== undefined) data.monthlyCost = b.monthlyCost === '' || b.monthlyCost === null ? null : Number(b.monthlyCost);
  if (b.password) data.passwordEnc = encryptSecret(String(b.password));
  const item = await prisma.vaultItem.update({ where: { id: req.params.id }, data });
  await logActivity({ actorId: req.user.id, type: 'VAULT_ITEM_UPDATED', detail: `Updated vault item "${item.name}"${b.password ? ' (password rotated)' : ''}`, ip: clientIp(req) });
  res.json({ item: maskItem(item, true) });
});

// ---------- REVEAL (every reveal is logged — powers the offboarding rotation checklist) ----------
router.post('/items/:id/reveal', async (req: AuthedRequest, res) => {
  const item = await prisma.vaultItem.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!req.user.isPrimaryAdmin) {
    const access = await prisma.vaultAccess.findUnique({ where: { itemId_userId: { itemId: item.id, userId: req.user.id } } });
    if (!access) return forbidden(res, 'This credential is not shared with you.');
  }
  if (!item.passwordEnc) return res.status(400).json({ error: 'No password stored on this item.' });
  await prisma.vaultViewLog.create({ data: { itemId: item.id, userId: req.user.id, action: 'REVEAL' } });
  await logActivity({ actorId: req.user.id, type: 'VAULT_REVEAL', detail: `Revealed password for "${item.name}"`, ip: clientIp(req) });
  res.json({ password: decryptSecret(item.passwordEnc) });
});

// ---------- SHARING (per-item, Primary Admin only) ----------
router.post('/items/:id/share', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const { userId, remove } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const item = await prisma.vaultItem.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (remove) {
    await prisma.vaultAccess.deleteMany({ where: { itemId: item.id, userId } });
    await logActivity({ actorId: req.user.id, type: 'VAULT_SHARE_REMOVED', targetUserId: userId, detail: `Removed sharing of "${item.name}"` });
  } else {
    await prisma.vaultAccess.upsert({ where: { itemId_userId: { itemId: item.id, userId } }, update: {}, create: { itemId: item.id, userId } });
    await logActivity({ actorId: req.user.id, type: 'VAULT_SHARED', targetUserId: userId, detail: `Shared vault item "${item.name}"` });
  }
  res.json({ ok: true });
});

// ---------- VIEW LOGS ----------
router.get('/items/:id/logs', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const logs = await prisma.vaultViewLog.findMany({
    where: { itemId: req.params.id },
    include: { user: { select: { name: true, username: true } } },
    orderBy: { createdAt: 'desc' }, take: 200,
  });
  res.json({ logs });
});

// ---------- RENEWALS DUE (7-day reminder window) ----------
router.get('/renewals', requirePrimaryAdmin, async (_req: AuthedRequest, res) => {
  const today = todayKey();
  const soon = addDaysKey(today, 7);
  const items = await prisma.vaultItem.findMany({ where: { renewalDate: { not: null } } });
  res.json({
    due: items
      .filter((i) => i.renewalDate! <= soon)
      .map((i) => ({ id: i.id, name: i.name, renewalDate: i.renewalDate, monthlyCost: i.monthlyCost, overdue: i.renewalDate! < today })),
  });
});

// ---------- EXPORT (Primary Admin only, logged) ----------
router.get('/export', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const items = await prisma.vaultItem.findMany({ orderBy: { name: 'asc' } });
  await prisma.vaultViewLog.createMany({ data: items.map((i) => ({ itemId: i.id, userId: req.user.id, action: 'EXPORT' })) });
  await logActivity({ actorId: req.user.id, type: 'VAULT_EXPORT', detail: `Exported the credentials vault (${items.length} items)`, ip: clientIp(req) });
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Name', 'Plan', 'Monthly cost', 'Renewal', 'Login email', 'Username', 'Password', 'OTP phone', 'SIM holder', 'Recovery email', 'Notes'].join(',')];
  for (const i of items) {
    rows.push([i.name, i.plan, i.monthlyCost, i.renewalDate, i.loginEmail, i.loginUsername, i.passwordEnc ? decryptSecret(i.passwordEnc) : '', i.otpPhone, i.otpHolder, i.recoveryEmail, i.notes].map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="asscher-vault-export.csv"');
  res.send(rows.join('\n'));
});

// ---------- DIRECTORY (auto-synced from profiles + external contacts) ----------
router.get('/directory', async (_req: AuthedRequest, res) => {
  const employees = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, username: true, email: true, phone: true, department: true, photoFileId: true },
    orderBy: { name: 'asc' },
  });
  const contacts = await prisma.externalContact.findMany({ orderBy: { name: 'asc' } });
  res.json({ employees, contacts });
});

router.post('/directory/contacts', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const { name, phone, email, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const c = await prisma.externalContact.create({ data: { name, phone: phone || null, email: email || null, notes: notes || null } });
  res.json({ contact: c });
});

router.delete('/directory/contacts/:id', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  await prisma.externalContact.delete({ where: { id: req.params.id } }).catch(() => {});
  res.json({ ok: true });
});

export default router;
