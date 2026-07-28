// Scheduled jobs. Cron fires when the server is awake; every job is ALSO run
// via lazy catch-up (on boot + periodically + on dashboard loads) so a
// free-tier host that sleeps overnight still produces correct results.
import cron from 'node-cron';
import { prisma } from './prisma';
import { catchUpStreaks } from './streakEngine';
import { ensureStipendRecords } from '../routes/hr';
import { notify, primaryAdminId } from './notify';
import { todayKey, isoWeekday, istDateTime, addDaysKey } from './time';

// ---------- Recurring tasks: spawn today's instances from templates ----------
export async function spawnRecurringTasks() {
  const today = todayKey();
  const state = await prisma.appState.findUnique({ where: { key: 'last_recurring_spawn' } });
  if (state?.value === today) return;

  const templates = await prisma.task.findMany({
    where: { isRecurringTemplate: true, archived: false },
    include: { assignees: true, resources: true },
  });
  for (const t of templates) {
    const rule: any = t.recurrenceRule || {};
    const freq = rule.freq || 'DAILY';
    if (freq === 'WEEKLY') {
      const days: number[] = rule.daysOfWeek || [1];
      if (!days.includes(isoWeekday(today))) continue;
    }
    // already spawned today?
    const dup = await prisma.task.findFirst({ where: { recurrenceParentId: t.id, startDate: today } });
    if (dup) continue;
    const dueTime = rule.dueTime || '18:00';
    const inst = await prisma.task.create({
      data: {
        title: t.title, description: t.description, protocol: t.protocol, priority: t.priority,
        createdById: t.createdById, startDate: today, dueAt: istDateTime(today, dueTime),
        submissionMethod: t.submissionMethod, checklistItems: t.checklistItems ?? undefined,
        recurrenceParentId: t.id,
      },
    });
    if (t.assignees.length) {
      await prisma.taskAssignee.createMany({ data: t.assignees.map((a) => ({ taskId: inst.id, userId: a.userId, assignedById: a.assignedById })) });
      await notify(t.assignees.map((a) => a.userId), { type: 'task_assigned', title: `Recurring task today: ${t.title}`, link: `/tasks/${inst.id}` });
    }
    if (t.resources.length) {
      await prisma.taskResource.createMany({ data: t.resources.map((r) => ({ taskId: inst.id, type: r.type, fileId: r.fileId, url: r.url, videoId: r.videoId, label: r.label })) });
    }
  }
  await prisma.appState.upsert({ where: { key: 'last_recurring_spawn' }, update: { value: today }, create: { key: 'last_recurring_spawn', value: today } });
}

// ---------- Subscription renewal reminders (7 days ahead) + stipend overdue nudges ----------
export async function dailyReminders() {
  const today = todayKey();
  const state = await prisma.appState.findUnique({ where: { key: 'last_daily_reminders' } });
  if (state?.value === today) return;
  const adminId = await primaryAdminId();
  if (adminId) {
    const soon = addDaysKey(today, 7);
    const items = await prisma.vaultItem.findMany({ where: { renewalDate: { not: null, lte: soon, gte: today } } });
    for (const i of items) {
      await notify(adminId, { type: 'renewal', title: `Subscription renewal due: ${i.name} on ${i.renewalDate}`, link: '/vault' });
    }
    const overdue = await prisma.stipendRecord.findMany({ where: { paidAt: null, dueDate: { lt: today } }, include: { user: { select: { name: true } } } });
    for (const o of overdue) {
      await notify(adminId, {
        type: 'stipend_overdue',
        title: `₹${o.amount.toLocaleString('en-IN')} ${o.kind === 'BONUS' ? 'bonus' : 'stipend'} overdue for ${o.user.name} (due ${o.dueDate})`,
        link: '/stipends', level: 'ALERT',
      });
    }
  }
  await prisma.appState.upsert({ where: { key: 'last_daily_reminders' }, update: { value: today }, create: { key: 'last_daily_reminders', value: today } });
}

export async function runCatchUp() {
  try { await catchUpStreaks(); } catch (e) { console.error('streak catch-up', e); }
  try { await spawnRecurringTasks(); } catch (e) { console.error('recurring spawn', e); }
  try { await ensureStipendRecords(); } catch (e) { console.error('stipend gen', e); }
  try { await dailyReminders(); } catch (e) { console.error('reminders', e); }
}

export function startJobs() {
  // Nightly streak evaluation at 00:05 IST
  cron.schedule('5 0 * * *', () => runCatchUp(), { timezone: 'Asia/Kolkata' });
  // Recurring tasks + reminders at 00:10 IST
  cron.schedule('10 0 * * *', () => runCatchUp(), { timezone: 'Asia/Kolkata' });
  // Morning reminder sweep 09:00 IST
  cron.schedule('0 9 * * *', () => runCatchUp(), { timezone: 'Asia/Kolkata' });
  // Safety: every 30 minutes, catch up anything missed (host slept, etc.)
  cron.schedule('*/30 * * * *', () => runCatchUp());
  // Run once on boot
  setTimeout(() => runCatchUp(), 3000);
}
