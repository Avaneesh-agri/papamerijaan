import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { newSessionToken, hashToken, generateStrongPassword } from '../lib/crypto';
import { requireAuth, requirePrimaryAdmin, AuthedRequest, clientIp } from '../middleware/auth';
import { logActivity } from '../lib/audit';
import { getSettings } from '../lib/settings';

const router = Router();

// ---------- LOGIN (username OR email + password) ----------
router.post('/login', async (req, res) => {
  const { identifier, password, deviceInfo } = req.body || {};
  if (!identifier || !password) return res.status(400).json({ error: 'Enter your username/email and password.' });

  const ident = String(identifier).trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: { equals: ident, mode: 'insensitive' } }, { email: { equals: ident, mode: 'insensitive' } }] },
  });

  const bad = () => res.status(401).json({ error: 'Invalid username/email or password.' });
  if (!user) return bad();
  if (user.status !== 'ACTIVE') return res.status(401).json({ error: 'This account has been deactivated. Contact your administrator.' });
  const ok = await bcrypt.compare(String(password), user.passwordHash);
  if (!ok) {
    await logActivity({ actorId: user.id, type: 'LOGIN_FAILED', detail: `Failed login attempt for ${user.username}`, ip: clientIp(req) });
    return bad();
  }

  const settings = await getSettings();
  const active = await prisma.session.findMany({ where: { userId: user.id, revokedAt: null }, orderBy: { createdAt: 'asc' } });

  if (user.isPrimaryAdmin) {
    // Primary Admin: up to N concurrent sessions (default 5). The (N+1)th login bumps the OLDEST.
    const limit = Number(settings.admin_session_limit) || 5;
    if (active.length >= limit) {
      const bump = active.slice(0, active.length - limit + 1);
      await prisma.session.updateMany({
        where: { id: { in: bump.map((s) => s.id) } },
        data: { revokedAt: new Date(), revokeReason: 'SESSION_LIMIT' },
      });
      await logActivity({ actorId: user.id, type: 'SESSION_KICK', detail: 'Oldest admin session bumped (session limit reached)', ip: clientIp(req) });
    }
  } else if (active.length > 0) {
    // Everyone else: ONE device at a time. New login instantly revokes previous sessions.
    await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'NEW_DEVICE' },
    });
    await logActivity({ actorId: user.id, type: 'SESSION_KICK', detail: 'Previous session revoked (signed in on another device)', ip: clientIp(req) });
  }

  const token = newSessionToken();
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      deviceInfo: String(deviceInfo || req.headers['user-agent'] || 'Unknown device').slice(0, 300),
      ip: clientIp(req),
    },
  });
  await logActivity({ actorId: user.id, type: 'LOGIN', detail: `Signed in`, ip: clientIp(req) });

  res.json({
    token,
    user: publicUser(user),
    mustChangePassword: user.mustChangePassword,
  });
});

router.post('/logout', requireAuth, async (req: AuthedRequest, res) => {
  await prisma.session.update({ where: { id: req.session.id }, data: { revokedAt: new Date(), revokeReason: 'LOGOUT' } });
  await logActivity({ actorId: req.user.id, type: 'LOGOUT', detail: 'Signed out', ip: clientIp(req) });
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req: AuthedRequest, res) => {
  const settings = await getSettings();
  const org = await prisma.user.count({ where: { managerId: req.user.id, status: 'ACTIVE' } });
  res.json({
    user: publicUser(req.user),
    isHead: org > 0,
    mustChangePassword: req.user.mustChangePassword,
    settings: { company_name: settings.company_name, eod_time: settings.eod_time },
  });
});

// Self password change (only when admin forced it, or user chooses; reset is admin-only)
router.post('/change-password', requireAuth, async (req: AuthedRequest, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const ok = await bcrypt.compare(String(currentPassword || ''), req.user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Current password is incorrect.' });
  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash: await bcrypt.hash(String(newPassword), 10), mustChangePassword: false },
  });
  await logActivity({ actorId: req.user.id, type: 'PASSWORD_CHANGED', detail: 'Changed own password', ip: clientIp(req) });
  res.json({ ok: true });
});

router.get('/generate-password', requireAuth, requirePrimaryAdmin, (_req, res) => {
  res.json({ password: generateStrongPassword() });
});

// ---------- SESSIONS PANEL (Primary Admin: every active session in the company) ----------
router.get('/sessions', requireAuth, requirePrimaryAdmin, async (_req, res) => {
  const sessions = await prisma.session.findMany({
    where: { revokedAt: null },
    orderBy: { lastSeen: 'desc' },
    include: { user: { select: { id: true, name: true, username: true, isPrimaryAdmin: true } } },
  });
  res.json({ sessions });
});

router.post('/sessions/:id/revoke', requireAuth, requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const s = await prisma.session.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!s) return res.status(404).json({ error: 'Session not found' });
  await prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date(), revokeReason: 'FORCED' } });
  await logActivity({
    actorId: req.user.id, type: 'SESSION_FORCE_LOGOUT', targetUserId: s.userId,
    detail: `Force-logged-out ${s.user.name} (${s.deviceInfo || 'device'})`, ip: clientIp(req),
  });
  res.json({ ok: true });
});

export function publicUser(u: any) {
  return {
    id: u.id, name: u.name, username: u.username, email: u.email, phone: u.phone,
    isPrimaryAdmin: u.isPrimaryAdmin, managerId: u.managerId, department: u.department,
    roleNotes: u.roleNotes, photoFileId: u.photoFileId, dateOfJoining: u.dateOfJoining,
    status: u.status, exitDate: u.exitDate,
  };
}

export default router;
