// Append-only activity log. Nothing here is ever updated or deleted.
import { prisma } from './prisma';

export async function logActivity(opts: {
  actorId?: string | null;
  type: string;
  detail: string;
  targetUserId?: string | null;
  meta?: any;
  ip?: string | null;
}) {
  try {
    await prisma.activityLog.create({
      data: {
        actorId: opts.actorId ?? null,
        type: opts.type,
        detail: opts.detail,
        targetUserId: opts.targetUserId ?? null,
        meta: opts.meta ?? undefined,
        ip: opts.ip ?? null,
      },
    });
  } catch (e) {
    console.error('audit log failed', e);
  }
}
