import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Tabs, Button, Badge, PageLoader, Empty, Input, Textarea, ErrorNote } from '../components/ui';
import { fmt, ago } from '../lib/format';

export default function Settings() {
  const { user } = useAuth();
  const [tab, setTab] = useState('app');
  if (!user.isPrimaryAdmin) return <Card><Empty icon="🔒" text="Settings are Primary Admin only" /></Card>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">⚙️ Settings</h1>
      <Tabs tabs={[{ key: 'app', label: 'App settings' }, { key: 'sessions', label: 'Sessions panel' }, { key: 'templates', label: 'Protocol templates' }]} active={tab} onChange={setTab} />
      {tab === 'app' && <AppSettings />}
      {tab === 'sessions' && <Sessions />}
      {tab === 'templates' && <Templates />}
    </div>
  );
}

function AppSettings() {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { api('/settings').then((d) => setS(d.settings)); }, []);
  if (!s) return <PageLoader />;
  const set = (k: string, v: any) => setS({ ...s, [k]: v });
  async function save() {
    setErr(''); setMsg('');
    try { await api('/settings', { method: 'PUT', body: { settings: s } }); setMsg('Saved ✓'); }
    catch (e: any) { setErr(e.message); }
  }
  return (
    <Card>
      <ErrorNote error={err} />
      {msg && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2 mb-3">{msg}</div>}
      <div className="grid sm:grid-cols-2 gap-4">
        <Input label="Company name" value={s.company_name} onChange={(e: any) => set('company_name', e.target.value)} />
        <Input label="EOD report time (IST, 24h)" type="time" value={s.eod_time} onChange={(e: any) => set('eod_time', e.target.value)} />
        <Input label="Primary Admin concurrent session limit" type="number" min={1} max={20} value={s.admin_session_limit} onChange={(e: any) => set('admin_session_limit', Number(e.target.value))} />
        <label className="flex items-center gap-2 text-sm text-slate-700 pt-5"><input type="checkbox" className="rounded" checked={!!s.report_required_for_streak} onChange={(e) => set('report_required_for_streak', e.target.checked)} /> Daily report must be on time for the streak</label>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="rounded" checked={!!s.heads_see_stipends} onChange={(e) => set('heads_see_stipends', e.target.checked)} /> Heads can see their subtree's stipend amounts</label>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="rounded" checked={!!s.force_password_change_on_first_login} onChange={(e) => set('force_password_change_on_first_login', e.target.checked)} /> Force password change on first login</label>
      </div>
      <Button className="mt-4" onClick={save}>Save settings</Button>
    </Card>
  );
}

function Sessions() {
  const [sessions, setSessions] = useState<any[] | null>(null);
  const load = () => api('/auth/sessions').then((d) => setSessions(d.sessions));
  useEffect(() => { load(); }, []);
  if (!sessions) return <PageLoader />;
  return (
    <Card title="Every active session in the company">
      {sessions.length === 0 ? <Empty text="No active sessions" /> : (
        <ul className="divide-y divide-slate-100">
          {sessions.map((s) => (
            <li key={s.id} className="py-2.5 flex flex-wrap items-center gap-2 text-sm">
              <div className="flex-1 min-w-[200px]">
                <b>{s.user.name}</b> {s.user.isPrimaryAdmin && <Badge color="bg-brand-100 text-brand-800">Admin</Badge>}
                <div className="text-xs text-slate-400">{s.deviceInfo || 'Unknown device'} · IP {s.ip || '—'} · signed in {fmt(s.createdAt)} · last seen {ago(s.lastSeen)}</div>
              </div>
              <Button size="sm" variant="danger" onClick={async () => { await api(`/auth/sessions/${s.id}/revoke`, { method: 'POST', body: {} }); load(); }}>Force logout</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Templates() {
  const [templates, setTemplates] = useState<any[] | null>(null);
  const [f, setF] = useState({ title: '', body: '' });
  const load = () => api('/tasks/templates/protocols').then((d) => setTemplates(d.templates));
  useEffect(() => { load(); }, []);
  if (!templates) return <PageLoader />;
  return (
    <Card title="Reusable protocol (SOP) templates — attach to tasks in one click">
      <div className="space-y-2 mb-4">
        <Input label="Template name" value={f.title} onChange={(e: any) => setF({ ...f, title: e.target.value })} placeholder="e.g. Protocol P-12: LinkedIn posting" />
        <Textarea label="Steps" value={f.body} onChange={(e: any) => setF({ ...f, body: e.target.value })} placeholder={'1. …\n2. …'} />
        <Button size="sm" onClick={async () => { await api('/tasks/templates/protocols', { body: f }); setF({ title: '', body: '' }); load(); }} disabled={!f.title || !f.body}>＋ Save template</Button>
      </div>
      {templates.length === 0 ? <Empty icon="📋" text="No templates yet" /> : (
        <ul className="divide-y divide-slate-100">
          {templates.map((t) => (
            <li key={t.id} className="py-2.5">
              <div className="flex items-center justify-between">
                <b className="text-sm text-slate-800">{t.title}</b>
                <Button size="sm" variant="ghost" onClick={async () => { await api(`/tasks/templates/protocols/${t.id}`, { method: 'DELETE' }); load(); }}>Delete</Button>
              </div>
              <pre className="text-xs text-slate-500 whitespace-pre-wrap font-sans mt-1">{t.body.slice(0, 200)}{t.body.length > 200 ? '…' : ''}</pre>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
