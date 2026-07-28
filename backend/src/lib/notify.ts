import { prisma } from './prisma';

export async function notify(
  userId: string | string[],
  n: { type: string; title: string; body?: string; link?: string; level?: 'NORMAL' | 'ALERT' }
) {
  const ids = Array.isArray(userId) ? [...new Set(userId)] : [userId];
  if (!ids.length) return;
  try {
    await prisma.notification.createMany({
      data: ids.map((id) => ({
        userId: id,
        type: n.type,
        title: n.title,
        body: n.body ?? null,
        link: n.link ?? null,
        level: n.level ?? 'NORMAL',
      })),
    });
  } catch (e) {
    console.error('notify failed', e);
  }
}

/** Primary admin id (cached briefly). */
let adminCache: { id: string; at: number } | null = null;
export async function primaryAdminId(): Promise<string | null> {
  if (adminCache && Date.now() - adminCache.at < 60_000) return adminCache.id;
  const admin = await prisma.user.findFirst({ where: { isPrimaryAdmin: true }, select: { id: true } });
  if (admin) adminCache = { id: admin.id, at: Date.now() };
  return admin?.id ?? null;
}
