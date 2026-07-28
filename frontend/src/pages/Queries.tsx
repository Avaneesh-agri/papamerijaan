import React, { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Tabs, Button, Badge, StatusBadge, PageLoader, Empty, Modal, Input, Textarea, Select, ErrorNote, UserPicker } from '../components/ui';
import { ago, fmtDate } from '../lib/format';

export default function Queries() {
  const { user, isHead } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'queries';
  const [filter, setFilter] = useState('all');
  const [queries, setQueries] = useState<any[] | null>(null);
  const [reqs, setReqs] = useState<any>(null);
  const [raise, setRaise] = useState(sp.get('raise') === 'req');
  const [raiseQ, setRaiseQ] = useState(false);
  const [form, setForm] = useState({ title: '', detail: '' });
  const [qForm, setQForm] = useState({ title: '', body: '', level: 'NORMAL' });
  const [err, setErr] = useState('');
  const [convert, setConvert] = useState<any>(null);
  const [convForm, setConvForm] = useState<any>({ assigneeIds: [], dueDate: '', dueTime: '18:00', priority: 'NORMAL' });
  const [users, setUsers] = useState<any[]>([]);

  const load = () => {
    api(`/queries?filter=${filter}`).then((d) => setQueries(d.queries));
    api('/queries/requirements/list').then(setReqs).catch(() => {});
  };
  useEffect(load, [filter]);
  useEffect(() => { api('/users').then((d) => setUsers(d.users.filter((u: any) => u.status === 'ACTIVE'))); }, []);

  async function submitReq() {
    setErr('');
    try { await api('/queries/requirements', { body: form }); setRaise(false); setForm({ title: '', detail: '' }); load(); }
    catch (e: any) { setErr(e.message); }
  }
  async function submitQuery() {
    setErr('');
    try { const d = await api('/queries', { body: qForm }); setRaiseQ(false); nav(`/queries/${d.query.id}`); }
    catch (e: any) { setErr(e.message); }
  }
  async function doConvert() {
    setErr('');
    try {
      const dueAt = convForm.dueDate ? new Date(`${convForm.dueDate}T${convForm.dueTime}:00+05:30`).toISOString() : null;
      const d = await api(`/queries/requirements/${convert.id}/convert`, { body: { assigneeIds: convForm.assigneeIds.length ? convForm.assigneeIds : undefined, dueAt, priority: convForm.priority } });
      setConvert(null); nav(`/tasks/${d.taskId}`);
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">Queries & Requirements</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setRaiseQ(true)}>💬 Raise query</Button>
          {(isHead && !user.isPrimaryAdmin) && <Button size="sm" variant="secondary" onClick={() => setRaise(true)}>📥 Raise requirement</Button>}
        </div>
      </div>
      <Tabs tabs={[{ key: 'queries', label: 'Queries' }, { key: 'requirements', label: user.isPrimaryAdmin ? 'Requirements inbox' : 'My requirements' }]} active={tab} onChange={(t) => setSp({ tab: t })} />

      {tab === 'queries' && (
        <Card>
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {[['all', 'All'], ['assigned', 'With me'], ['mine', 'Raised by me'], ['later', 'Solve later']].map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-full text-xs font-medium ${filter === k ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{l}</button>
            ))}
          </div>
          {!queries ? <PageLoader /> : queries.length === 0 ? <Empty icon="💬" text="No queries" /> : (
            <ul className="divide-y divide-slate-100">
              {queries.map((q) => (
                <li key={q.id}>
                  <Link to={`/queries/${q.id}`} className={`flex flex-wrap items-center gap-2 py-3 -mx-2 px-2 rounded-lg hover:bg-slate-50 ${q.level === 'ALERT' && q.status !== 'RESOLVED' ? 'bg-rose-50' : ''}`}>
                    {q.level === 'ALERT' && q.status !== 'RESOLVED' && <Badge color="bg-rose-600 text-white" className="animate-pulse">🔴 ALERT</Badge>}
                    <div className="flex-1 min-w-[160px]">
                      <div className={`text-sm font-medium ${q.level === 'ALERT' && q.status !== 'RESOLVED' ? 'text-rose-700' : 'text-slate-800'}`}>{q.title}</div>
                      <div className="text-xs text-slate-400">{q.raisedByName} → {q.holderName}{q.escalations > 0 && ` · escalated ×${q.escalations}`} · {ago(q.updatedAt)}</div>
                    </div>
                    <StatusBadge status={q.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'requirements' && (
        <Card>
          {!reqs ? <PageLoader /> : reqs.requirements.length === 0 ? <Empty icon="📥" text={user.isPrimaryAdmin ? 'Inbox empty — heads raise requirements here' : 'You have not raised any requirements'} /> : (
            <ul className="divide-y divide-slate-100">
              {reqs.requirements.map((r: any) => (
                <li key={r.id} className="py-3 flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-[180px]">
                    <div className="text-sm font-medium text-slate-800">{r.title}</div>
                    <div className="text-xs text-slate-400">{reqs.users[r.raisedById]?.name}{reqs.users[r.raisedById]?.department ? ` · ${reqs.users[r.raisedById].department}` : ''} · {fmtDate(r.createdAt)}</div>
                    {r.detail && <p className="text-xs text-slate-500 mt-0.5">{r.detail}</p>}
                    {r.decisionNote && <p className="text-xs text-amber-700 mt-0.5">Note: {r.decisionNote}</p>}
                  </div>
                  <StatusBadge status={r.status} />
                  {user.isPrimaryAdmin && r.status === 'OPEN' && (
                    <div className="flex gap-1.5">
                      <Button size="sm" onClick={() => { setConvert(r); setConvForm({ assigneeIds: [r.raisedById], dueDate: '', dueTime: '18:00', priority: 'NORMAL' }); }}>⚡ Convert to task</Button>
                      <Button size="sm" variant="secondary" onClick={async () => { const note = prompt('Note (optional)') || ''; await api(`/queries/requirements/${r.id}/decide`, { body: { status: 'DONE', note } }); load(); }}>✓ Done</Button>
                      <Button size="sm" variant="ghost" onClick={async () => { const note = prompt('Why decline?') || ''; await api(`/queries/requirements/${r.id}/decide`, { body: { status: 'DECLINED', note } }); load(); }}>✕</Button>
                    </div>
                  )}
                  {r.convertedTaskId && <Link to={`/tasks/${r.convertedTaskId}`} className="text-xs text-brand-700 font-medium">View task →</Link>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Modal open={raise} onClose={() => setRaise(false)} title="Raise requirement to the Primary Admin">
        <ErrorNote error={err} />
        <div className="space-y-3">
          <Input label="What do you need? *" value={form.title} onChange={(e: any) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Need 1 more video editor" />
          <Textarea label="Details / justification" value={form.detail} onChange={(e: any) => setForm({ ...form, detail: e.target.value })} />
          <Button onClick={submitReq} disabled={!form.title.trim()}>Send to Primary Admin</Button>
        </div>
      </Modal>

      <Modal open={raiseQ} onClose={() => setRaiseQ(false)} title="Raise a query to your manager">
        <ErrorNote error={err} />
        <div className="space-y-3">
          <Input label="Title *" value={qForm.title} onChange={(e: any) => setQForm({ ...qForm, title: e.target.value })} />
          <Textarea label="Details" value={qForm.body} onChange={(e: any) => setQForm({ ...qForm, body: e.target.value })} />
          <div className="flex gap-2 flex-wrap">
            {['NORMAL', 'ALERT', 'LATER'].map((l) => (
              <button key={l} onClick={() => setQForm({ ...qForm, level: l })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${qForm.level === l ? (l === 'ALERT' ? 'bg-rose-600 text-white border-rose-600' : 'bg-brand-700 text-white border-brand-700') : 'border-slate-300 text-slate-600'}`}>
                {l === 'ALERT' ? '🔴 Alert (urgent)' : l === 'LATER' ? 'Solve later' : 'Normal'}
              </button>
            ))}
          </div>
          <Button onClick={submitQuery} disabled={!qForm.title.trim()}>Raise query</Button>
        </div>
      </Modal>

      <Modal open={!!convert} onClose={() => setConvert(null)} title={`Convert to task: ${convert?.title || ''}`}>
        <ErrorNote error={err} />
        <div className="space-y-3">
          <UserPicker users={users} value={convForm.assigneeIds} onChange={(x: any) => setConvForm({ ...convForm, assigneeIds: x })} label="Assign to (defaults to the head who raised it)" />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Deadline date" type="date" value={convForm.dueDate} onChange={(e: any) => setConvForm({ ...convForm, dueDate: e.target.value })} />
            <Input label="Time (IST)" type="time" value={convForm.dueTime} onChange={(e: any) => setConvForm({ ...convForm, dueTime: e.target.value })} />
          </div>
          <Select label="Priority" value={convForm.priority} onChange={(e: any) => setConvForm({ ...convForm, priority: e.target.value })}>
            <option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="ALERT">🔴 Alert</option>
          </Select>
          <Button onClick={doConvert}>⚡ Create pre-filled task</Button>
        </div>
      </Modal>
    </div>
  );
}
