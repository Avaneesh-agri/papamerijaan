// All day-boundary logic in the app uses Asia/Kolkata (IST).
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export const TZ = 'Asia/Kolkata';

export function nowIST() {
  return dayjs().tz(TZ);
}

/** Today's IST calendar date as "YYYY-MM-DD". */
export function todayKey(): string {
  return nowIST().format('YYYY-MM-DD');
}

/** IST calendar date of any Date/ISO string. */
export function keyOf(d: Date | string): string {
  return dayjs(d).tz(TZ).format('YYYY-MM-DD');
}

export function addDaysKey(key: string, days: number): string {
  return dayjs.tz(key, TZ).add(days, 'day').format('YYYY-MM-DD');
}

export function monthOfKey(key: string): string {
  return key.slice(0, 7); // "2026-07"
}

/** A Date for "HH:mm" on a given IST dateKey. */
export function istDateTime(dateKey: string, hhmm: string): Date {
  return dayjs.tz(`${dateKey} ${hhmm}`, 'YYYY-MM-DD HH:mm', TZ).toDate();
}

/** Start/end of an IST calendar day as UTC Dates (for querying DateTime columns). */
export function dayBounds(dateKey: string): { start: Date; end: Date } {
  const start = dayjs.tz(dateKey, TZ).startOf('day');
  return { start: start.toDate(), end: start.add(1, 'day').toDate() };
}

export function fmtIST(d: Date | string | null | undefined, format = 'DD MMM YYYY, h:mm A'): string {
  if (!d) return '';
  return dayjs(d).tz(TZ).format(format);
}

/** ISO week day 1=Mon..7=Sun for a dateKey in IST. */
export function isoWeekday(dateKey: string): number {
  const d = dayjs.tz(dateKey, TZ).day(); // 0=Sun..6=Sat
  return d === 0 ? 7 : d;
}

export { dayjs };
