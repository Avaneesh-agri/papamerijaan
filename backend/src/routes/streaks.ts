import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePrimaryAdmin, AuthedRequest, forbidden } from '../middleware/auth';
import { getScope, canSeeUser } from '../lib/org';
import { logActivity } from '../lib/audit';
import { catchUpStreaks, evaluateDay } from '../lib/streakEngine';
import { monthOfKey, todayKey, addDaysKey } from '../lib/time';

const router = Router();
router.use(requireAuth);

async function monthCalendar(userId: string, month: string) {
  const days = await prisma.streakDay.findMany({
    where: { userId, dateKey: { gte: `${month}-01`, lte: `${month}-31` } },
    orderBy: { dateKey: 'asc' },
  });
  const onTime = days.filter((d) => d.result === 'COUNTED').length;
  // best run within the month
  let best = 0, run = 0;
  for (const d of days) {
    if (d.result === 'COUNTED') { run++; best = Math.max(best, run); }
    else if (d.result === 'BROKE') run = 0;
  }
  return { month, days, summary: { onTimeDays: onTime, neutralDays: days.filter((d) => d.result === 'NEUTRAL').length, brokeDays: days.filter((d) => d.result === 'BROKE').length, bestRunThisMonth: best } };
}

router.get('/me', async (req: AuthedRequest, res) => {
  const month = String(req.query.month || monthOfKey(todayKey()));
  const streak = await prisma.streak.findUnique({ where: { userId: req.user.id } });
  res.json({ streak: streak || { current: 0, best: 0 }, calendar: await monthCalendar(req.user.id, month) });
});

router.get('/user/:id', async (req: AuthedRequest, res) => {
  if (!(await canSeeUser(req.user, req.params.id))) return forbidden(res);
  const month = String(req.query.month || monthOfKey(todayKey()));
  const streak = await prisma.streak.findUnique({ where: { userId: req.params.id } });
  res.json({ streak: streak || { current: 0, best: 0 }, calendar: await monthCalendar(req.params.id, month) });
});

// Team leaderboard (per subtree)
router.get('/leaderboard', async (req: AuthedRequest, res) => {
  const { ids } = await getScope(req.user);
  const users = await prisma.user.findMany({ where: { id: { in: [...ids] }, status: 'ACTIVE', isPrimaryAdmin: false }, select: { id: true, name: true, department: true, photoFileId: true } });
  const streaks = await prisma.streak.findMany({ where: { userId: { in: users.map((u) => u.id) } } });
  const map = new Map(streaks.map((s) => [s.userId, s]));
  const board = users
    .map((u) => ({ user: u, current: map.get(u.id)?.current ?? 0, best: map.get(u.id)?.best ?? 0 }))
    .sort((a, b) => b.current - a.current || b.best - a.best);
  res.json({ board });
});

// Milestone feed (admin: company-wide; heads: own subtree) — input for manual stipend bonuses
router.get('/milestones', async (req: AuthedRequest, res) => {
  const { ids } = await getScope(req.user);
  const events = await prisma.milestoneEvent.findMany({
    where: { userId: { in: [...ids] } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(events.map((e) => e.userId))] } }, select: { id: true, name: true } });
  res.json({ events, users: Object.fromEntries(users.map((u) => [u.id, u.name])) });
});

// Manual adjust / restore (Primary Admin, always logged)
router.post('/adjust', requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const { userId, setTo, reason } = req.body || {};
  if (!userId || setTo === undefined || !String(reason || '').trim()) return res.status(400).json({ error: 'userId, setTo and a reason are required.' });
  const val = Math.max(0, Number(setTo) || 0);
  const s = await prisma.streak.upsert({
    where: { userId },
    update: { current: val, best: { increment: 0 } },
    create: { userId, current: val, best: val },
  });
  if (val > s.best) await prisma.streak.update({ where: { userId }, data: { best: val } });
  await prisma.streakAdjustment.create({ data: { userId, byId: req.user.id, setTo: val, reason } });
  await logActivity({ actorId: req.user.id, type: 'STREAK_ADJUSTED', targetUserId: userId, detail: `Manually set streak to ${val}: ${reason}` });
  res.json({ ok: true });
});

// Manual run (admin) — also runs automatically at 00:05 IST nightly + lazy catch-up
router.post('/run', requirePrimaryAdmin, async (_req: AuthedRequest, res) => {
  await catchUpStreaks();
  res.json({ ok: true, evaluatedThrough: addDaysKey(todayKey(), -1) });
});

export default router;
