import { prisma } from './prisma';

export const DEFAULT_SETTINGS: Record<string, any> = {
  company_name: 'Asscher AI',
  eod_time: '20:00', // daily report deadline, IST
  report_required_for_streak: true,
  admin_session_limit: 5,
  heads_see_stipends: false,
  force_password_change_on_first_login: false,
  leave_balance_tracking: false,
  leave_balance_per_year: 12,
  streak_milestones: [7, 15, 30, 60, 100],
  digest_enabled: false,
};

let cache: Record<string, any> | null = null;
let cacheAt = 0;

export async function getSettings(): Promise<Record<string, any>> {
  if (cache && Date.now() - cacheAt < 15_000) return cache;
  const rows = await prisma.appSetting.findMany();
  const merged = { ...DEFAULT_SETTINGS };
  for (const r of rows) merged[r.key] = r.value as any;
  cache = merged;
  cacheAt = Date.now();
  return merged;
}

export async function setSetting(key: string, value: any) {
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  cache = null;
}

export function invalidateSettingsCache() {
  cache = null;
}
