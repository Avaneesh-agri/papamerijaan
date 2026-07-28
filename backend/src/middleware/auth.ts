import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { hashToken } from '../lib/crypto';

export interface AuthedRequest extends Request {
  user?: any;
  session?: any;
}

export function clientIp(req: Request): string {
  const fwd = (req.headers['x-forwarded-for'] as string) || '';
  return (fwd.split(',')[0] || req.socket.remoteAddress || '').trim();
}

const REVOKE_MESSAGES: Record<string, string> = {
  NEW_DEVICE: 'You were signed out because this account was signed in on another device.',
  SESSION_LIMIT: 'You were signed out because the session limit was reached on another device.',
  FORCED: 'You were signed out by an administrator.',
  DEACTIVATED: 'This account has been deactivated. Contact your administrator.',
  LOGOUT: 'You have been signed out.',
};

/** Every permission check in the app is server-side. This gate runs before every /api route (except login + video embed). */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in', code: 'NO_SESSION' });

  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session) return res.status(401).json({ error: 'Session not found. Please sign in again.', code: 'NO_SESSION' });

  if (session.revokedAt) {
    const reason = session.revokeReason || 'LOGOUT';
    return res.status(401).json({
      error: REVOKE_MESSAGES[reason] || REVOKE_MESSAGES.LOGOUT,
      code: 'SESSION_REVOKED',
      reason,
    });
  }
  if (session.user.status !== 'ACTIVE') {
    return res.status(401).json({ error: REVOKE_MESSAGES.DEACTIVATED, code: 'SESSION_REVOKED', reason: 'DEACTIVATED' });
  }

  // touch lastSeen (throttled to once/min to reduce writes)
  if (Date.now() - new Date(session.lastSeen).getTime() > 60_000) {
    prisma.session.update({ where: { id: session.id }, data: { lastSeen: new Date() } }).catch(() => {});
  }

  req.user = session.user;
  req.session = session;
  next();
}

export function requirePrimaryAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user?.isPrimaryAdmin) {
    return res.status(403).json({ error: 'Only the Primary Admin can do this.' });
  }
  next();
}

export function forbidden(res: Response, msg = 'You do not have access to this.') {
  return res.status(403).json({ error: msg });
}
