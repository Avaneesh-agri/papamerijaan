import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, PageLoader, Empty, Avatar, Badge, Button, Modal, Input, Textarea, ErrorNote } from '../components/ui';
import { monthKey, fmtDate } from '../lib/format';
import StreakCalendar from '../components/StreakCalendar';

export default function Streaks() {
  const { user, isHead } = useAuth();
  const [me, setMe] = useState<any>(null);
  const [board, setBoard] = useState<any[] | null>(null);
  const [milestones, setMilestones] = useState<any>(null);
  const [month, setMonth] = useState(monthKey());
  const [adjust, setAdjust] = useState<any>(null);
  const [adjForm, setAdjForm] = useState({ setTo: '', reason: '' });
  const [err, setErr] = useState('');

  const load = () => {
    api(`/streaks/me?month=${month}`).then(setMe);
    api('/streaks/leaderboard').then((d) => setBoard(d.board));
    api('/streaks/milestones').then(setMilestones).catch(() => {});
  };
  useEffect(load, [month]);
  if (!me) return <PageLoader />;

  async function doAdjust() {
    setErr('');
    try {
      await api('/streaks/adjust', { body: { userId: adjust.user.id, setTo: Number(adjForm.setTo), reason: adjForm.reason } });
      setAdjust(null); setAdjForm({ setTo: '', reason: '' }); load();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">Streaks</h1>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-5xl font-black text-brand-700">{me.streak.current}</div>
              <div className="text-xs text-slate-500 mt-1">current streak 🔥</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-slate-700">{me.streak.best}</div>
              <div className="text-xs text-slate-500 mt-1">best ever</div>
            </div>
            <div className="flex-1 text-xs text-slate-500">
              A working day counts when every task due that day is submitted on time (and your daily report is on time). Holidays & approved leave freeze the streak — they never break it.
              <div className="mt-1.5 flex gap-1 flex-wrap">{[7, 15, 30, 60, 100].map((m) => (
                <Badge key={m} color={me.streak.best >= m ? 'bg-amber-400 text-amber-900' : 'bg-slate-100 text-slate-400'}>🏅 {m}</Badge>
              ))}</div>
            </div>
          </div>
        </Card>
        <Card title="My monthly record" action={<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="text-xs border border-slate-300 rounded-lg px-2 py-1" />}>
          <StreakCalendar calendar={me.calendar} />
          <div className="text-xs text-slate-500 mt-2">{me.calendar.summary.onTimeDays} on-time · {me.calendar.summary.neutralDays} neutral · best run this month {me.calendar.summary.bestRunThisMonth}. Stored permanently, month after month.</div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Team leaderboard">
          {!board ? <PageLoader /> : board.length === 0 ? <Empty icon="🔥" text="No team members visible" /> : (
            <ul className="divide-y divide-slate-100">
              {board.map((row, i) => (
                <li key={row.user.id} className="flex items-center gap-3 py-2.5">
                  <span className="w-6 text-center font-bold text-slate-400">{i + 1}</span>
                  <Avatar name={row.user.name} size={7} />
                  <Link to={`/people/${row.user.id}`} className="flex-1 text-sm font-medium text-slate-700">{row.user.name}</Link>
                  <span className="text-sm font-bold">{row.current} 🔥</span>
                  <span className="text-xs text-slate-400">best {row.best}</span>
                  {user.isPrimaryAdmin && <Button size="sm" variant="ghost" onClick={() => { setAdjust(row); setAdjForm({ setTo: String(row.current), reason: '' }); }}>adjust</Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Milestone feed 🔥 (input for manual stipend bonuses)">
          {!milestones || milestones.events.length === 0 ? <Empty icon="🏅" text="No milestones yet" /> : (
            <ul className="divide-y divide-slate-100">
              {milestones.events.map((e: any) => (
                <li key={e.id} className="py-2 text-sm text-slate-700">🔥 <b>{milestones.users[e.userId]}</b> hit a <b>{e.days}-day</b> streak <span className="text-xs text-slate-400">{fmtDate(e.dateKey)}</span>
                  {user.isPrimaryAdmin && <Link to="/stipends" className="text-xs text-brand-700 ml-2">give bonus →</Link>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={!!adjust} onClose={() => setAdjust(null)} title={`Adjust streak — ${adjust?.user?.name}`}>
        <ErrorNote error={err} />
        <div className="space-y-3">
          <Input label="Set current streak to" type="number" min={0} value={adjForm.setTo} onChange={(e: any) => setAdjForm({ ...adjForm, setTo: e.target.value })} />
          <Textarea label="Reason (mandatory — every adjustment is logged)" value={adjForm.reason} onChange={(e: any) => setAdjForm({ ...adjForm, reason: e.target.value })} />
          <Button onClick={doAdjust} disabled={!adjForm.reason.trim()}>Save adjustment</Button>
        </div>
      </Modal>
    </div>
  );
}
