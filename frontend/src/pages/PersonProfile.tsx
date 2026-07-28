import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, openFile, uploadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Button, Badge, PageLoader, Modal, Input, Select, ErrorNote, Avatar, Empty, Tabs } from '../components/ui';
import { fmtDate, fmt, inr, monthKey } from '../lib/format';
import StreakCalendar from '../components/StreakCalendar';

export default function PersonProfile() {
  const { id } = useParams();
  const { user, refresh } = useAuth();
  const [d, setD] = useState<any>(null);
  const [perf, setPerf] = useState<any>(null);
  const [streak, setStreak] = useState<any>(null);
  const [training, setTraining] = useState<any[]>([]);
  const [stipends, setStipends] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(false);
  const [offboard, setOffboard] = useState(false);
  const [month, setMonth] = useState(monthKey());

  const load = () => {
    setErr('');
    api(`/users/${id}`).then(setD).catch((e) => setErr(e.message));
    api(`/users/${id}/performance`).then(setPerf).catch(() => {});
    api(`/streaks/user/${id}?month=${month}`).then(setStreak).catch(() => {});
    api(`/videos/history/user/${id}`).then((x) => setTraining(x.views)).catch(() => {});
    api(`/hr/stipends/user/${id}`).then((x) => setStipends(x.records)).catch(() => {});
  };
  useEffect(load, [id, month]);

  if (err && !d) return <div className="max-w-lg mx-auto mt-10"><Card><div className="text-center py-6"><div className="text-3xl mb-2">🔒</div>{err}</div></Card></div>;
  if (!d) return <PageLoader />;
  const u = d.user;

  return (
    <div className="space-y-4 max-w-4xl">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={u.name} size={14} />
          <div className="flex-1 min-w-[200px]">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-800">{u.name}</h1>
              {u.isPrimaryAdmin && <Badge color="bg-brand-700 text-white">Primary Admin</Badge>}
              {u.isHead && !u.isPrimaryAdmin && <Badge color="bg-indigo-100 text-indigo-700">Head</Badge>}
              {u.status === 'EXITED' && <Badge color="bg-slate-200 text-slate-600">Exited {fmtDate(u.exitDate)}</Badge>}
            </div>
            <div className="text-sm text-slate-500 mt-0.5">@{u.username} · {u.email} · 📞 {u.phone}</div>
            <div className="text-xs text-slate-400 mt-0.5">
              {u.department && `${u.department} · `}Joined {fmtDate(u.dateOfJoining)}
              {u.manager && <> · Reports to <Link className="text-brand-700" to={`/people/${u.manager.id}`}>{u.manager.name}</Link></>}
            </div>
            {u.roleNotes && <div className="text-xs text-slate-500 mt-1">📝 {u.roleNotes}</div>}
          </div>
          <div className="flex flex-col gap-2">
            {user.isPrimaryAdmin && <Button size="sm" variant="secondary" onClick={() => setEdit(true)}>✏️ Edit / reset password</Button>}
            {user.isPrimaryAdmin && !u.isPrimaryAdmin && u.status === 'ACTIVE' && <Button size="sm" variant="danger" onClick={() => setOffboard(true)}>Deactivate (offboard)</Button>}
            {user.isPrimaryAdmin && u.status === 'EXITED' && <Button size="sm" variant="secondary" onClick={() => setOffboard(true)}>View exit checklist</Button>}
          </div>
        </div>
      </Card>

      {/* Compensation (admin/self) */}
      {u.stipendAmount != null && (
        <Card title="Compensation (visible to Primary Admin & the person)">
          <div className="flex flex-wrap gap-6 text-sm">
            <div><div className="text-xs text-slate-400">Stipend / salary</div><div className="font-bold text-lg">{inr(u.stipendAmount)}</div></div>
            <div><div className="text-xs text-slate-400">Cycle</div><div>{u.payCycle || 'MONTHLY'}</div></div>
            {u.payDay && <div><div className="text-xs text-slate-400">Pay day</div><div>{u.payDay}th</div></div>}
          </div>
          {stipends.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-2">
              <div className="text-xs font-semibold text-slate-500 mb-1">Payment history</div>
              {stipends.slice(0, 8).map((s) => (
                <div key={s.id} className="flex justify-between text-sm py-1">
                  <span>{s.periodKey} {s.kind === 'BONUS' && <Badge color="bg-amber-100 text-amber-700">Bonus</Badge>}</span>
                  <span>{inr(s.amount)}</span>
                  <span className={s.paidAt ? 'text-emerald-600 text-xs' : 'text-rose-600 text-xs'}>{s.paidAt ? `Paid ${fmtDate(s.paidAt)}` : `Due ${fmtDate(s.dueDate)}`}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Performance */}
      {perf && (
        <Card title="Performance">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-center">
            {[
              ['Assigned', perf.stats.totalAssigned], ['Completed', perf.stats.completed],
              ['On-time %', perf.stats.onTimePct == null ? '—' : perf.stats.onTimePct + '%'],
              ['Late', perf.stats.lateCount], ['Reports', perf.stats.reportsSubmitted],
              ['Streak', `${perf.stats.currentStreak} 🔥`], ['Best', perf.stats.bestStreak],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-lg bg-slate-50 py-2.5"><div className="text-lg font-bold text-slate-800">{v}</div><div className="text-[11px] text-slate-400">{l}</div></div>
            ))}
          </div>
        </Card>
      )}

      {/* Monthly streak calendar */}
      {streak && (
        <Card title="Streak record" action={<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="text-xs border border-slate-300 rounded-lg px-2 py-1" />}>
          <StreakCalendar calendar={streak.calendar} />
          <div className="text-xs text-slate-500 mt-2">
            This month: {streak.calendar.summary.onTimeDays} on-time · {streak.calendar.summary.neutralDays} leave/holiday · best run {streak.calendar.summary.bestRunThisMonth}
          </div>
        </Card>
      )}

      {/* Documents (admin/self) */}
      {(user.isPrimaryAdmin || user.id === u.id) && (
        <Card title="Documents (ID, agreement…)">
          {u.documents?.length ? (
            <ul className="space-y-1.5 mb-3">
              {u.documents.map((doc: any) => (
                <li key={doc.id}><button onClick={() => openFile(doc.fileId)} className="text-sm text-brand-700 hover:underline">📄 {doc.label}</button> <span className="text-xs text-slate-400">{fmtDate(doc.createdAt)}</span></li>
              ))}
            </ul>
          ) : <div className="text-xs text-slate-400 mb-3">No documents uploaded</div>}
          {user.isPrimaryAdmin && <UploadDoc userId={u.id} onDone={load} />}
        </Card>
      )}

      {/* Training history */}
      <Card title="Training history">
        {training.length === 0 ? <Empty icon="🎬" text="No videos watched yet" /> : (
          <ul className="divide-y divide-slate-100">
            {training.slice(0, 15).map((v: any) => (
              <li key={v.id} className="py-2 flex justify-between text-sm">
                <Link to={`/videos/${v.video.id}`} className="text-slate-700">🎬 {v.video.title} <span className="text-xs text-slate-400">({v.video.category})</span></Link>
                <span className="text-xs text-slate-400">{fmt(v.openedAt)}{v.durationSec ? ` · ~${Math.round(v.durationSec / 60)} min` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {edit && <EditUserModal u={u} onClose={() => { setEdit(false); load(); refresh(); }} />}
      {offboard && <OffboardModal u={u} onClose={() => { setOffboard(false); load(); }} />}
    </div>
  );
}

function UploadDoc({ userId, onDone }: any) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap gap-2 items-end">
      <div className="flex-1 min-w-[140px]"><Input label="Label" value={label} onChange={(e: any) => setLabel(e.target.value)} placeholder="e.g. Aadhaar card" /></div>
      <label className={`cursor-pointer ${!label ? 'opacity-50 pointer-events-none' : ''}`}>
        <span className="inline-flex items-center rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-2 text-sm">{busy ? 'Uploading…' : '📎 Choose file'}</span>
        <input type="file" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          setBusy(true);
          try { const up = await uploadFile(f, 'PROFILE'); await api(`/users/${userId}/documents`, { body: { fileId: up.id, label } }); setLabel(''); onDone(); }
          finally { setBusy(false); }
        }} />
      </label>
    </div>
  );
}

function EditUserModal({ u, onClose }: any) {
  const [f, setF] = useState<any>({ name: u.name, username: u.username, email: u.email, phone: u.phone, department: u.department || '', roleNotes: u.roleNotes || '', managerId: u.managerId || '', stipendAmount: u.stipendAmount ?? '', payDay: u.payDay ?? 5, dateOfJoining: u.dateOfJoining || '', password: '', forceChange: false });
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => { api('/users?includeExited=0').then((d) => setUsers(d.users)); }, []);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  async function save() {
    setErr('');
    try { await api(`/users/${u.id}`, { method: 'PATCH', body: { ...f, password: f.password || undefined } }); onClose(); }
    catch (e: any) { setErr(e.message); }
  }
  return (
    <Modal open onClose={onClose} title={`Edit ${u.name}`} wide>
      <ErrorNote error={err} />
      <div className="grid sm:grid-cols-2 gap-3">
        <Input label="Name" value={f.name} onChange={(e: any) => set('name', e.target.value)} />
        <Input label="Username" value={f.username} onChange={(e: any) => set('username', e.target.value)} />
        <Input label="Email" value={f.email} onChange={(e: any) => set('email', e.target.value)} />
        <Input label="Phone" value={f.phone} onChange={(e: any) => set('phone', e.target.value)} />
        <Select label="Manager" value={f.managerId} onChange={(e: any) => set('managerId', e.target.value)}>
          <option value="">— none —</option>
          {users.filter((x: any) => x.id !== u.id).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
        <Input label="Department" value={f.department} onChange={(e: any) => set('department', e.target.value)} />
        <Input label="Date of joining" type="date" value={f.dateOfJoining || ''} onChange={(e: any) => set('dateOfJoining', e.target.value)} />
        <Input label="Role notes" value={f.roleNotes} onChange={(e: any) => set('roleNotes', e.target.value)} />
        <Input label="Stipend (₹)" type="number" value={f.stipendAmount} onChange={(e: any) => set('stipendAmount', e.target.value)} />
        <Input label="Pay day" type="number" min={1} max={28} value={f.payDay} onChange={(e: any) => set('payDay', e.target.value)} />
        <div className="sm:col-span-2 border-t border-slate-100 pt-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1"><Input label="Reset password (leave blank to keep)" value={f.password} onChange={(e: any) => set('password', e.target.value)} /></div>
            <Button variant="secondary" onClick={async () => set('password', (await api('/auth/generate-password')).password)}>🎲 Generate</Button>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600 mt-2"><input type="checkbox" checked={f.forceChange} onChange={(e) => set('forceChange', e.target.checked)} className="rounded" /> Force password change on next login</label>
          <p className="text-[11px] text-slate-400 mt-1">Resetting a password signs the person out of all devices instantly.</p>
        </div>
      </div>
      <div className="flex gap-2 mt-4"><Button onClick={save}>Save</Button><Button variant="secondary" onClick={onClose}>Cancel</Button></div>
    </Modal>
  );
}

function OffboardModal({ u, onClose }: any) {
  const [checklist, setChecklist] = useState<any>(null);
  const [err, setErr] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [reassignTo, setReassignTo] = useState('');
  const [done, setDone] = useState<string[]>([]);
  const exited = u.status === 'EXITED';

  const loadChecklist = () => api(`/users/${u.id}/exit-checklist`).then(setChecklist).catch((e) => setErr(e.message));
  useEffect(() => { if (exited) loadChecklist(); api('/users').then((d) => setUsers(d.users.filter((x: any) => x.status === 'ACTIVE' && x.id !== u.id))); }, []);

  async function deactivate() {
    setErr('');
    try { await api(`/users/${u.id}/deactivate`, { method: 'POST', body: {} }); await loadChecklist(); }
    catch (e: any) { setErr(e.message); }
  }
  async function reassign(taskId: string) {
    if (!reassignTo) { setErr('Pick who to reassign to first.'); return; }
    await api(`/users/${u.id}/reassign-task`, { body: { taskId, toUserId: reassignTo } });
    loadChecklist();
  }

  return (
    <Modal open onClose={onClose} title={exited || checklist ? `Exit checklist — ${u.name}` : `Deactivate ${u.name}?`} wide>
      <ErrorNote error={err} />
      {!checklist ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">This will, in one action:</p>
          <ul className="text-sm text-slate-600 list-disc pl-5 space-y-1">
            <li>Instantly revoke every session and block login</li>
            <li><b>Retain everything</b> — tasks, reports, files and history stay queryable forever; profile becomes “Exited”</li>
            <li>Flag their open tasks for one-click reassignment</li>
            <li>Generate the exit checklist, including every vault credential they ever revealed (for rotation)</li>
          </ul>
          <Button variant="danger" onClick={deactivate}>Deactivate now</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2">Account deactivated — sessions revoked, data retained.</div>
          <div>
            <div className="font-semibold text-sm text-slate-700 mb-1.5">Open tasks to reassign ({checklist.openTasks.length})</div>
            {checklist.openTasks.length > 0 && (
              <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-2">
                <option value="">Reassign to…</option>
                {users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            )}
            {checklist.openTasks.map((t: any) => (
              <div key={t.taskId} className="flex items-center gap-2 py-1.5 text-sm border-b border-slate-50">
                <Link to={`/tasks/${t.taskId}`} className="flex-1 text-slate-700">{t.title}</Link>
                <Button size="sm" variant="secondary" onClick={() => reassign(t.taskId)}>→ Reassign</Button>
              </div>
            ))}
            {!checklist.openTasks.length && <div className="text-xs text-slate-400">None 🎉</div>}
          </div>
          <div>
            <div className="font-semibold text-sm text-slate-700 mb-1.5">🔐 Credentials they revealed — rotate these ({checklist.credentialsToRotate.length})</div>
            {checklist.credentialsToRotate.map((c: any) => (
              <label key={c.itemId} className="flex items-center gap-2 py-1.5 text-sm border-b border-slate-50">
                <input type="checkbox" className="rounded" checked={done.includes(c.itemId)} onChange={() => setDone(done.includes(c.itemId) ? done.filter((x) => x !== c.itemId) : [...done, c.itemId])} />
                <span className={`flex-1 ${done.includes(c.itemId) ? 'line-through text-slate-400' : 'text-slate-700'}`}>{c.name}{c.loginEmail ? ` (${c.loginEmail})` : ''}</span>
                <Link to="/vault" className="text-xs text-brand-700">rotate in vault →</Link>
              </label>
            ))}
            {!checklist.credentialsToRotate.length && <div className="text-xs text-slate-400">They never revealed any credentials.</div>}
          </div>
          <div>
            <div className="font-semibold text-sm text-slate-700 mb-1.5">Physical assets to collect</div>
            {checklist.physicalAssets.map((a: string) => <div key={a} className="text-sm text-slate-600 py-0.5">☐ {a}</div>)}
          </div>
        </div>
      )}
    </Modal>
  );
}
