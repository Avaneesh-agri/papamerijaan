import React from 'react';
import { dayjs, TZ } from '../lib/format';

/** Monthly streak calendar: green = counted, amber = holiday/leave (neutral), red = broke, grey = not evaluated. */
export default function StreakCalendar({ calendar }: { calendar: { month: string; days: any[] } }) {
  const start = dayjs.tz(`${calendar.month}-01`, TZ);
  const daysInMonth = start.daysInMonth();
  const firstDow = (start.day() + 6) % 7; // Monday-first
  const map = new Map(calendar.days.map((d: any) => [d.dateKey, d]));
  const cells: any[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calendar.month}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, info: map.get(key) });
  }
  const color = (info: any) => !info ? 'bg-slate-100 text-slate-400'
    : info.result === 'COUNTED' ? 'bg-emerald-500 text-white'
    : info.result === 'NEUTRAL' ? 'bg-amber-300 text-amber-900'
    : 'bg-rose-500 text-white';
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-400 mb-1">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => c === null ? <div key={i} /> : (
          <div key={i} title={c.info ? `${c.info.result}${c.info.reason ? ` — ${c.info.reason}` : ''}` : 'Not evaluated'}
            className={`aspect-square rounded-md flex items-center justify-center text-xs font-semibold ${color(c.info)}`}>
            {c.day}
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-2 text-[10px] text-slate-500">
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500 mr-1" />On time</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-300 mr-1" />Holiday/leave (frozen)</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-500 mr-1" />Streak broke</span>
      </div>
    </div>
  );
}
