// Streak engine — evaluates one IST calendar day for every user.
// Working day = not a company holiday and not an approved leave day for that user.
// +1 when every task due that day was submitted on or before its deadline
// (and, if the setting is ON, the daily report was on time). Miss/late → reset to 0.
// Holidays & approved leave are NEUTRAL: the streak freezes, never breaks.
// A deadline falling on a holiday rolls to the next working day.
import { prisma } from './prisma';
import { getSettings } from './settings';
import { notify, primaryAdminId } from './notify';
import { logActivity } from './audit';
import { addDaysKey, dayBounds, keyOf, todayKey, istDateTime } from './time';

async function holidaySet(): Promise<Set<string>> {
  const rows = await prisma.holiday.findMany({ select: { dateKey: true } });
  return new Set(rows.map((r) => r.dateKey));
}

function rollForward(dueKey: string, holidays: Set<string>): string {
  let k = dueKey;
  let guard = 0;
  while (holidays.has(k) && guard++ < 30) k = addDaysKey(k, 1);
  return k;
}

export async function evaluateDay(dateKey: string) {
  const settings = await getSettings();
  const holidays = await holidaySet();
  const milestones: number[] = settings.streak_milestones || [7, 15, 30, 60, 100];
  const reportRequired = settings.report_required_for_streak !== false;
  const eod = String(settings.eod_time || '20:00');

  const users = await prisma.user.findMany({ where: { status: 'ACTIVE', isPrimaryAdmin: false } });
  const adminId = await primaryAdminId();

  for (const user of users) {
    if (user.dateOfJoining && user.dateOfJoining > dateKey) continue;
    const existing = await prisma.streakDay.findUnique({ where: { userId_dateKey: { userId: user.id, dateKey } } });
    if (existing) continue; // idempotent

    // Neutral day? (holiday or approved leave) → frozen
    let neutralReason: string | null = null;
    if (holidays.has(dateKey)) neutralReason = 'Company holiday';
    else {
      const leave = await prisma.leave.findFirst({
        where: { userId: user.id, status: 'APPROVED', startDate: { lte: dateKey }, endDate: { gte: dateKey } },
      });
      if (leave) neutralReason = 'Approved leave';
    }
    if (neutralReason) {
      await prisma.streakDay.create({ data: { userId: user.id, dateKey, result: 'NEUTRAL', reason: neutralReason } });
      continue;
    }

    // Assignments effectively due this day (deadline on a holiday rolls forward)
    const windowStart = dayBounds(addDaysKey(dateKey, -14)).start;
    const windowEnd = dayBounds(dateKey).end;
    const assignments = await prisma.taskAssignee.findMany({
      where: { userId: user.id, task: { isRecurringTemplate: false, archived: false, dueAt: { gte: windowStart, lt: windowEnd } } },
      include: { task: { select: { id: true, title: true, dueAt: true } } },
    });
    const dueToday = assignments.filter((a) => {
      const dk = keyOf(a.task.dueAt!);
      return rollForward(dk, holidays) === dateKey;
    });

    const lateItems: string[] = [];
    for (const a of dueToday) {
      const origKey = keyOf(a.task.dueAt!);
      const effectiveDue =
        origKey === dateKey
          ? new Date(a.task.dueAt!)
          : istDateTime(dateKey, keyOf(a.task.dueAt!) ? new Date(a.task.dueAt!).toISOString().slice(11, 16) : '23:59');
      // effective deadline keeps the original clock time on the rolled day
      const rolledDue = origKey === dateKey ? new Date(a.task.dueAt!) : istDateTime(dateKey, fmtHM(a.task.dueAt!));
      const firstSub = await prisma.submission.findFirst({
        where: { taskId: a.taskId, userId: user.id },
        orderBy: { submittedAt: 'asc' },
      });
      if (!firstSub || new Date(firstSub.submittedAt) > rolledDue) lateItems.push(a.task.title);
    }

    let reportOk = true;
    if (reportRequired) {
      const report = await prisma.dailyReport.findUnique({ where: { userId_dateKey: { userId: user.id, dateKey } } });
      reportOk = !!report && report.status !== 'DRAFT' && !report.late;
    }

    const counted = lateItems.length === 0 && reportOk;
    const streak = await prisma.streak.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });

    if (counted) {
      const current = streak.current + 1;
      const best = Math.max(streak.best, current);
      await prisma.streak.update({ where: { userId: user.id }, data: { current, best, lastCountedDate: dateKey } });
      await prisma.streakDay.create({
        data: { userId: user.id, dateKey, result: 'COUNTED', detail: { due: dueToday.length, reportOk } },
      });
      if (milestones.includes(current)) {
        await prisma.milestoneEvent.create({ data: { userId: user.id, days: current, dateKey } });
        const title = `🔥 ${user.name} just hit a ${current}-day streak`;
        await notify(user.id, { type: 'streak', title: `🔥 You hit a ${current}-day streak!`, link: '/streaks' });
        if (user.managerId) await notify(user.managerId, { type: 'streak', title, link: `/people/${user.id}` });
        if (adminId && adminId !== user.managerId) await notify(adminId, { type: 'streak', title, link: `/people/${user.id}` });
        await logActivity({ actorId: user.id, type: 'STREAK_MILESTONE', detail: `Hit a ${current}-day streak` });
      }
    } else {
      const reason = lateItems.length ? `Missed/late: ${lateItems.slice(0, 3).join(', ')}${lateItems.length > 3 ? '…' : ''}` : 'Daily report missing or late';
      await prisma.streak.update({ where: { userId: user.id }, data: { current: 0 } });
      await prisma.streakDay.create({ data: { userId: user.id, dateKey, result: 'BROKE', reason, detail: { late: lateItems, reportOk } } });
      if (streak.current > 0) {
        await notify(user.id, { type: 'streak', title: `Your ${streak.current}-day streak reset`, body: reason, link: '/streaks' });
      }
    }
  }
}

function fmtHM(d: Date | string): string {
  const dt = new Date(d);
  // clock time in IST
  const ist = new Date(dt.getTime() + 5.5 * 3600 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}

/** Evaluate every un-evaluated day up to yesterday (IST). Safe to call any time. */
export async function catchUpStreaks() {
  const yesterday = addDaysKey(todayKey(), -1);
  const state = await prisma.appState.findUnique({ where: { key: 'last_streak_eval' } });
  let from: string;
  if (!state) {
    await prisma.appState.create({ data: { key: 'last_streak_eval', value: addDaysKey(yesterday, -1) } });
    from = yesterday;
  } else {
    if (state.value >= yesterday) return;
    from = addDaysKey(state.value, 1);
  }
  let k = from;
  let guard = 0;
  while (k <= yesterday && guard++ < 62) {
    await evaluateDay(k);
    await prisma.appState.upsert({ where: { key: 'last_streak_eval' }, update: { value: k }, create: { key: 'last_streak_eval', value: k } });
    k = addDaysKey(k, 1);
  }
}
