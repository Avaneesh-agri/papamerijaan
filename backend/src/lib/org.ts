// Org-tree helpers. The company is a tree via users.managerId (unlimited depth).
// Visibility rule: every user sees THEIR OWN SUBTREE ONLY (self + all descendants).
// The Primary Admin sees everyone.
import { prisma } from './prisma';

export interface OrgUserLite {
  id: string;
  managerId: string | null;
  status: string;
  isPrimaryAdmin: boolean;
  name: string;
  department: string | null;
}

export async function loadOrg(): Promise<Map<string, OrgUserLite>> {
  const users = await prisma.user.findMany({
    select: { id: true, managerId: true, status: true, isPrimaryAdmin: true, name: true, department: true },
  });
  return new Map(users.map((u) => [u.id, u]));
}

/** All ids in a user's subtree, including the user themself. Includes exited users (records stay queryable). */
export function subtreeIds(org: Map<string, OrgUserLite>, rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const u of org.values()) {
    if (u.managerId) {
      if (!children.has(u.managerId)) children.set(u.managerId, []);
      children.get(u.managerId)!.push(u.id);
    }
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const c of children.get(id) || []) stack.push(c);
  }
  return out;
}

/** Chain of managers above a user (direct manager first). */
export function ancestorIds(org: Map<string, OrgUserLite>, userId: string): string[] {
  const out: string[] = [];
  let cur = org.get(userId);
  const guard = new Set<string>([userId]);
  while (cur && cur.managerId && !guard.has(cur.managerId)) {
    out.push(cur.managerId);
    guard.add(cur.managerId);
    cur = org.get(cur.managerId);
  }
  return out;
}

export async function getScope(actor: { id: string; isPrimaryAdmin: boolean }) {
  const org = await loadOrg();
  const ids = actor.isPrimaryAdmin ? new Set(org.keys()) : subtreeIds(org, actor.id);
  return { org, ids, all: actor.isPrimaryAdmin };
}

/** true if actor may see/act on target (self, or target inside actor's subtree, or actor is Primary Admin). */
export async function canSeeUser(actor: { id: string; isPrimaryAdmin: boolean }, targetId: string): Promise<boolean> {
  if (actor.isPrimaryAdmin || actor.id === targetId) return true;
  const org = await loadOrg();
  return subtreeIds(org, actor.id).has(targetId);
}

export function isHead(org: Map<string, OrgUserLite>, userId: string): boolean {
  for (const u of org.values()) if (u.managerId === userId && u.status === 'ACTIVE') return true;
  return false;
}
