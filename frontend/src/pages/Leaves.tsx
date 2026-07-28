import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, uploadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Tabs, Button, Badge, StatusBadge, PageLoader, Empty, Modal, Input, Select, Textarea, ErrorNote } from '../components/ui';
import { fmtDate, monthKey, dayjs, TZ } from '../lib/format';

export default function Leaves() {
  const { user, isHead } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'mine';
  const tabs = [
    { key: 'mine', label: 'My leaves' },
    ...(isHead || user.isPrimaryAdmin ? [{ key: 'approvals', label: 'Approvals' }] : []),
    { key: 'calendar', label: 'Team calendar' },
    ...(user.isPrimaryAdmin ? [{ key: 'holidays', label: 'Holidays' }] : []),
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">Leave & holidays</h1>
      <Tabs tabs={tabs} active={tab} onChange={(t) => setSp({ tab: t })} />
      {tab === 'mine' && <MyLeaves />}
      {tab === 'approvals' && <Approvals />}
      {tab === 'calendar' && <TeamCalendar />}
      {tab === 'holidays' && <Holidays />}
    </div>
  );
}

function MyLeaves() {
  const [leaves, setLeaves] = useState<any[] | null>(null);
  const [apply, setApply] = useState(false);
  const [f, setF] = useState<any>({ type: 'CASUAL', startDate: '', endDate: '', reason: '' });
  const [file, setFile] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = () => api('/hr/leaves?tab=mine').then((d) => setLeaves(d.leaves));
  useEffect(() => { load(); }, []);

  async function submit() {
    setErr('');
    try {
      await api('/hr/leaves', { body: { ...f, endDate: f.endDate || f.startDate, attachmentFileId: file?.id || null } });
      setApply(false); setF({ type: 'CASUAL', startDate: '', endDate: '', reason: '' }); setFile(null); load();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <>
      <div className="text-right mb-3"><Button size="sm" onClick={() => setApply(true)}>＋ Apply for leave</Button></div>
      <Card>
        {!leaves ? <PageLoader /> : leaves.length === 0 ? <Empty icon="🌴" text="No leave applications yet" /> : (
          <ul className="divide-y divide-slate-100">
            {leaves.map((l) => (
              <li key={l.id} className="py-3 flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-[180px]">
                  <div className="text-sm font-medium text-slate-800">{fmtDate(l.startDate)} → {fmtDate(l.endDate)} <Badge>{l.type}</Badge></div>
                  {l.reason && <div className="text-xs text-slate-500">{l.reason}</div>}
                  {l.decisionNote && <div className="text-xs text-amber-700">Note: {l.decisionNote}</div>}
                </div>
                <StatusBadge status={l.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={apply} onClose={() => setApply(false)} title="Apply for leave">
        <ErrorNote error={err} />
        <div className="space-y-3">
          <Select label="Type" value={f.type} onChange={(e: any) => setF({ ...f, type: e.target.value })}>
            <option value="CASUAL">Casual</option><option value="SICK">Sick</option><option value="OTHER">Other</option>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input label="From *" type="date" value={f.startDate} onChange={(e: any) => setF({ ...f, startDate: e.target.value })} />
            <Input label="To" type="date" value={f.endDate} onChange={(e: any) => setF({ ...f, endDate: e.target.value })} />
          </div>
          <Textarea label="Reason" value={f.reason} onChange={(e: any) => setF({ ...f, reason: e.target.value })} />
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Attachment (optional, e.g. medical note)</span>
            <input type="file" className="block mt-1 text-xs" onChange={async (e) => { const fl = e.target.files?.[0]; if (fl) setFile(await uploadFile(fl, 'GENERAL')); }} />
            {file && <span className="text-xs text-emerald-600">📄 {file.name} ✓</span>}
          </label>
          <Button onClick={submit} disabled={!f.startDate}>Send to my manager</Button>
        </div>
      </Modal>
    </>
  );
}

function Approvals() {
  const [leaves, setLeaves] = useState<any[] | null>(null);
  const load = () => api('/hr/leaves?tab=approvals').then((d) => setLeaves(d.leaves));
  useEffect(() => { load(); }, []);
  async function decide(id: string, decision: string) {
    const note = prompt(`${decision === 'APPROVED' ? 'Approve' : 'Reject'} — note (optional)`) ?? '';
    await api(`/hr/leaves/${id}/decide`, { body: { decision, note } });
    load();
  }
  if (!leaves) return <PageLoader />;
  return (
    <Card>
      {leaves.length === 0 ? <Empty icon="🌴" text="No leave applications" /> : (
        <ul className="divide-y divide-slate-100">
          {leaves.map((l) => (
            <li key={l.id} className="py-3 flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[200px]">
                <div className="text-sm font-medium text-slate-800">{l.user.name}: {fmtDate(l.startDate)} → {fmtDate(l.endDate)} <Badge>{l.type}</Badge></div>
                {l.reason && <div className="text-xs text-slate-500">{l.reason}</div>}
              </div>
              <StatusBadge status={l.status} />
              {l.status === 'PENDING' ? (
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={() => decide(l.id, 'APPROVED')}>✓ Approve</Button>
                  <Button size="sm" variant="danger" onClick={() => decide(l.id, 'REJECTED')}>✕ Reject</Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => decide(l.id, l.status === 'APPROVED' ? 'REJECTED' : 'APPROVED')}>Override</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TeamCalendar() {
  const [month, setMonth] = useState(monthKey());
  const [d, setD] = useState<any>(null);
  useEffect(() => { setD(null); api(`/hr/leaves?tab=calendar&month=${month}`).then(setD); }, [month]);
  if (!d) return <PageLoader />;
  const start = dayjs.tz(`${month}-01`, TZ);
  const days = start.daysInMonth();
  return (
    <Card title="Team leave calendar" action={<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="text-xs border border-slate-300 rounded-lg px-2 py-1" />}>
      <div className="space-y-1.5">
        {d.holidays.map((h: any) => <div key={h.id} className="text-sm">🎉 <b>{fmtDate(h.dateKey)}</b> — {h.name} <Badge color="bg-amber-100 text-amber-700">Company holiday</Badge></div>)}
        {d.leaves.map((l: any) => <div key={l.id} className="text-sm">🌴 <b>{l.user.name}</b>: {fmtDate(l.startDate)} → {fmtDate(l.endDate)} ({l.type})</div>)}
        {!d.leaves.length && !d.holidays.length && <Empty icon="🗓️" text="Nothing this month — full attendance" />}
      </div>
    </Card>
  );
}

function Holidays() {
  const [holidays, setHolidays] = useState<any[] | null>(null);
  const [f, setF] = useState({ dateKey: '', name: '' });
  const load = () => api('/hr/holidays').then((d) => setHolidays(d.holidays));
  useEffect(() => { load(); }, []);
  if (!holidays) return <PageLoader />;
  return (
    <Card title="Company holiday calendar (applies company-wide, feeds streaks & reports)">
      <div className="flex flex-wrap gap-2 mb-4">
        <input type="date" value={f.dateKey} onChange={(e) => setF({ ...f, dateKey: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Holiday name" className="flex-1 min-w-[140px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        <Button size="sm" onClick={async () => { await api('/hr/holidays', { body: f }); setF({ dateKey: '', name: '' }); load(); }} disabled={!f.dateKey || !f.name}>＋ Add</Button>
      </div>
      {holidays.length === 0 ? <Empty icon="🎉" text="No holidays set" /> : (
        <ul className="divide-y divide-slate-100">
          {holidays.map((h) => (
            <li key={h.id} className="py-2 flex items-center justify-between text-sm">
              <span>🎉 <b>{fmtDate(h.dateKey)}</b> — {h.name}</span>
              <Button size="sm" variant="ghost" onClick={async () => { await api(`/hr/holidays/${h.dateKey}`, { method: 'DELETE' }); load(); }}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
