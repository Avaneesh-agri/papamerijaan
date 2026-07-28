import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(utc); dayjs.extend(timezone); dayjs.extend(relativeTime);
export const TZ = 'Asia/Kolkata';

export const fmt = (d?: string | Date | null, f = 'DD MMM, h:mm A') => (d ? dayjs(d).tz(TZ).format(f) : '—');
export const fmtDate = (d?: string | null) => (d ? dayjs.tz(d, TZ).format('DD MMM YYYY') : '—');
export const fmtTime = (d?: string | Date | null) => (d ? dayjs(d).tz(TZ).format('h:mm A') : '—');
export const ago = (d?: string | Date | null) => (d ? dayjs(d).fromNow() : '');
export const todayKey = () => dayjs().tz(TZ).format('YYYY-MM-DD');
export const monthKey = () => dayjs().tz(TZ).format('YYYY-MM');
export const inr = (n?: number | null) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);
export { dayjs };

export const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: 'Assigned', OPENED: 'Opened', IN_PROGRESS: 'In progress', SUBMITTED: 'Under review',
  UNDER_REVIEW: 'Under review', APPROVED: 'Approved', RETURNED: 'Returned',
  DRAFT: 'Draft', REVIEWED: 'Reviewed', FORWARDED: 'Forwarded', NOT_FILED: 'Not filed',
  OPEN: 'Open', PARKED: 'Solve later', RESOLVED: 'Resolved',
  PENDING: 'Pending', CONVERTED: 'Converted', DECLINED: 'Declined', DONE: 'Done',
};
export const STATUS_COLOR: Record<string, string> = {
  ASSIGNED: 'bg-slate-100 text-slate-700', OPENED: 'bg-sky-100 text-sky-800',
  IN_PROGRESS: 'bg-amber-100 text-amber-800', SUBMITTED: 'bg-violet-100 text-violet-800',
  UNDER_REVIEW: 'bg-violet-100 text-violet-800', APPROVED: 'bg-emerald-100 text-emerald-800',
  RETURNED: 'bg-rose-100 text-rose-800', DRAFT: 'bg-slate-100 text-slate-600',
  REVIEWED: 'bg-emerald-100 text-emerald-800', FORWARDED: 'bg-brand-100 text-brand-800',
  NOT_FILED: 'bg-slate-100 text-slate-500', OPEN: 'bg-sky-100 text-sky-800',
  PARKED: 'bg-slate-100 text-slate-600', RESOLVED: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800', CONVERTED: 'bg-emerald-100 text-emerald-800',
  DECLINED: 'bg-rose-100 text-rose-700', DONE: 'bg-emerald-100 text-emerald-800',
};
