import React, { useEffect, useState } from 'react';
import { api, downloadUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Tabs, Button, Badge, PageLoader, Empty, Modal, Input, Textarea, ErrorNote, Avatar } from '../components/ui';
import { fmtDate, fmt, inr, todayKey } from '../lib/format';

export default function Vault() {
  const { user } = useAuth();
  const [tab, setTab] = useState('subs');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">🔐 Assets & credentials vault</h1>
        {user.isPrimaryAdmin && <Button size="sm" variant="secondary" onClick={() => downloadUrl('/vault/export', 'asscher-vault-export.csv')}>⬇ Export (logged)</Button>}
      </div>
      <Tabs tabs={[{ key: 'subs', label: 'Subscriptions & logins' }, { key: 'dir', label: 'Directory' }]} active={tab} onChange={setTab} />
      {tab === 'subs' ? <Subscriptions /> : <Directory />}
    </div>
  );
}

function Subscriptions() {
  const { user } = useAuth();
  const [d, setD] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null); // item being edited or 'new'
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [share, setShare] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [logs, setLogs] = useState<any>(null);
  const [err, setErr] = useState('');

  const load = () => api('/vault/items').then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); if (user.isPrimaryAdmin) api('/users').then((x) => setUsers(x.users.filter((u: any) => u.status === 'ACTIVE' && !u.isPrimaryAdmin))); }, []);
  if (err && !d) return <Card><div className="text-center py-6">🔒 {err}</div></Card>;
  if (!d) return <PageLoader />;

  async function reveal(id: string) {
    try {
      const r = await api(`/vault/items/${id}/reveal`, { method: 'POST', body: {} });
      setRevealed({ ...revealed, [id]: r.password });
      setTimeout(() => setRevealed((p) => { const n = { ...p }; delete n[id]; return n; }), 30_000);
    } catch (e: any) { alert(e.message); }
  }

  const today = todayKey();

  return (
    <>
      {user.isPrimaryAdmin && <div className="text-right mb-3"><Button size="sm" onClick={() => setEdit('new')}>＋ Add item</Button></div>}
      {d.items.length === 0 ? <Card><Empty icon="🔐" text={d.full ? 'No items yet' : 'Nothing has been shared with you'} /></Card> : (
        <div className="grid md:grid-cols-2 gap-4">
          {d.items.map((it: any) => (
            <Card key={it.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-slate-800">{it.name}</div>
                  <div className="text-xs text-slate-500">{it.plan && `${it.plan} · `}{it.monthlyCost != null && `${inr(it.monthlyCost)}/mo · `}
                    {it.renewalDate && <span className={it.renewalDate < today ? 'text-rose-600 font-bold' : ''}>renews {fmtDate(it.renewalDate)}</span>}
                  </div>
                </div>
                {user.isPrimaryAdmin && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setShare(it)}>👥</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { const l = await api(`/vault/items/${it.id}/logs`); setLogs({ item: it, logs: l.logs }); }}>🕒</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEdit(it)}>✏️</Button>
                  </div>
                )}
              </div>
              <dl className="mt-2.5 space-y-1.5 text-sm">
                {it.loginEmail && <Row k="Login email" v={it.loginEmail} copy />}
                {it.loginUsername && <Row k="Username" v={it.loginUsername} copy />}
                {it.hasPassword && (
                  <div className="flex items-center gap-2">
                    <dt className="w-28 shrink-0 text-xs text-slate-400">Password</dt>
                    <dd className="flex-1 font-mono text-xs">
                      {revealed[it.id] ? <span className="bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">{revealed[it.id]}</span> : '••••••••••'}
                    </dd>
                    <Button size="sm" variant="secondary" onClick={() => revealed[it.id] ? setRevealed((p) => { const n = { ...p }; delete n[it.id]; return n; }) : reveal(it.id)}>
                      {revealed[it.id] ? 'Hide' : '👁 Reveal'}
                    </Button>
                  </div>
                )}
                {it.otpPhone && <Row k="2FA / OTP phone" v={`${it.otpPhone}${it.otpHolder ? ` — for codes, call ${it.otpHolder}` : ''}`} />}
                {it.recoveryEmail && <Row k="Recovery email" v={it.recoveryEmail} />}
                {it.notes && <Row k="Notes" v={it.notes} />}
                {d.full && it.sharedWith?.length > 0 && (
                  <div className="flex items-center gap-2 pt-1"><dt className="w-28 shrink-0 text-xs text-slate-400">Shared with</dt>
                    <dd className="flex flex-wrap gap-1">{it.sharedWith.map((s: any) => <Badge key={s.userId}>{s.name}</Badge>)}</dd></div>
                )}
              </dl>
              <p className="text-[10px] text-slate-300 mt-2">Every reveal is logged (who, when) — powers the offboarding rotation checklist.</p>
            </Card>
          ))}
        </div>
      )}

      {edit && <ItemModal item={edit === 'new' ? null : edit} onClose={() => { setEdit(null); load(); }} />}

      <Modal open={!!share} onClose={() => setShare(null)} title={`Share "${share?.name}" with heads`}>
        <p className="text-xs text-slate-500 mb-2">Only people you tick can see this card and reveal its password. Everyone else sees nothing.</p>
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
          {users.map((u) => {
            const has = share?.sharedWith?.some((s: any) => s.userId === u.id);
            return (
              <button key={u.id} className="w-full flex items-center gap-2 py-2 text-sm hover:bg-slate-50 px-1"
                onClick={async () => { await api(`/vault/items/${share.id}/share`, { body: { userId: u.id, remove: has } }); const fresh = await api('/vault/items'); setD(fresh); setShare(fresh.items.find((x: any) => x.id === share.id)); }}>
                <Avatar name={u.name} size={6} />
                <span className="flex-1 text-left">{u.name}</span>
                {has ? <Badge color="bg-emerald-100 text-emerald-700">✓ shared</Badge> : <Badge>not shared</Badge>}
              </button>
            );
          })}
        </div>
      </Modal>

      <Modal open={!!logs} onClose={() => setLogs(null)} title={`Reveal log — ${logs?.item?.name}`}>
        {logs?.logs?.length ? (
          <ul className="divide-y divide-slate-100">
            {logs.logs.map((l: any) => (
              <li key={l.id} className="py-2 text-sm flex justify-between"><span><b>{l.user.name}</b> · {l.action.toLowerCase()}</span><span className="text-xs text-slate-400">{fmt(l.createdAt)}</span></li>
            ))}
          </ul>
        ) : <Empty icon="🕒" text="Never revealed" />}
      </Modal>
    </>
  );
}

function Row({ k, v, copy }: any) {
  return (
    <div className="flex items-start gap-2">
      <dt className="w-28 shrink-0 text-xs text-slate-400 pt-0.5">{k}</dt>
      <dd className="flex-1 text-slate-700 break-all">{v} {copy && <button className="text-[10px] text-brand-700" onClick={() => navigator.clipboard?.writeText(v)}>copy</button>}</dd>
    </div>
  );
}

function ItemModal({ item, onClose }: any) {
  const [f, setF] = useState<any>({
    name: item?.name || '', plan: item?.plan || '', monthlyCost: item?.monthlyCost ?? '', renewalDate: item?.renewalDate || '',
    loginEmail: item?.loginEmail || '', loginUsername: item?.loginUsername || '', password: '',
    otpPhone: item?.otpPhone || '', otpHolder: item?.otpHolder || '', recoveryEmail: item?.recoveryEmail || '', notes: item?.notes || '',
  });
  const [err, setErr] = useState('');
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  async function save() {
    setErr('');
    try {
      if (item) await api(`/vault/items/${item.id}`, { method: 'PATCH', body: { ...f, password: f.password || undefined } });
      else await api('/vault/items', { body: f });
      onClose();
    } catch (e: any) { setErr(e.message); }
  }
  return (
    <Modal open onClose={onClose} title={item ? `Edit ${item.name}` : 'Add subscription / login'} wide>
      <ErrorNote error={err} />
      <div className="grid sm:grid-cols-2 gap-3">
        <Input label="Tool / service name *" value={f.name} onChange={(e: any) => set('name', e.target.value)} />
        <Input label="Plan" value={f.plan} onChange={(e: any) => set('plan', e.target.value)} placeholder="e.g. Teams" />
        <Input label="Monthly cost (₹)" type="number" value={f.monthlyCost} onChange={(e: any) => set('monthlyCost', e.target.value)} />
        <Input label="Renewal date" type="date" value={f.renewalDate} onChange={(e: any) => set('renewalDate', e.target.value)} />
        <Input label="Login email" value={f.loginEmail} onChange={(e: any) => set('loginEmail', e.target.value)} />
        <Input label="Login username" value={f.loginUsername} onChange={(e: any) => set('loginUsername', e.target.value)} />
        <Input label={item ? 'New password (blank = keep; setting = rotate)' : 'Password (encrypted at rest)'} value={f.password} onChange={(e: any) => set('password', e.target.value)} />
        <Input label="2FA / OTP phone" value={f.otpPhone} onChange={(e: any) => set('otpPhone', e.target.value)} placeholder="98xxxxxx10" />
        <Input label="Who holds that SIM?" value={f.otpHolder} onChange={(e: any) => set('otpHolder', e.target.value)} placeholder="e.g. Amit" />
        <Input label="Recovery email" value={f.recoveryEmail} onChange={(e: any) => set('recoveryEmail', e.target.value)} />
        <div className="sm:col-span-2"><Textarea label="Notes" value={f.notes} onChange={(e: any) => set('notes', e.target.value)} /></div>
      </div>
      <div className="flex gap-2 mt-4"><Button onClick={save} disabled={!f.name}>Save</Button><Button variant="secondary" onClick={onClose}>Cancel</Button></div>
    </Modal>
  );
}

function Directory() {
  const { user } = useAuth();
  const [d, setD] = useState<any>(null);
  const [f, setF] = useState({ name: '', phone: '', email: '', notes: '' });
  const load = () => api('/vault/directory').then(setD);
  useEffect(() => { load(); }, []);
  if (!d) return <PageLoader />;
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Employees (auto-synced from profiles)">
        <ul className="divide-y divide-slate-100">
          {d.employees.map((e: any) => (
            <li key={e.id} className="py-2.5 flex items-center gap-2.5">
              <Avatar name={e.name} size={7} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-700">{e.name} {e.department && <span className="text-xs text-slate-400">· {e.department}</span>}</div>
                <div className="text-xs text-slate-500">📞 <a href={`tel:${e.phone}`} className="text-brand-700">{e.phone}</a> · ✉️ {e.email}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="External contacts">
        {user.isPrimaryAdmin && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <Input placeholder="Name *" value={f.name} onChange={(e: any) => setF({ ...f, name: e.target.value })} />
            <Input placeholder="Phone" value={f.phone} onChange={(e: any) => setF({ ...f, phone: e.target.value })} />
            <Input placeholder="Email" value={f.email} onChange={(e: any) => setF({ ...f, email: e.target.value })} />
            <div className="flex gap-2">
              <Input placeholder="Notes" value={f.notes} onChange={(e: any) => setF({ ...f, notes: e.target.value })} className="flex-1" />
              <Button size="sm" onClick={async () => { await api('/vault/directory/contacts', { body: f }); setF({ name: '', phone: '', email: '', notes: '' }); load(); }} disabled={!f.name}>＋</Button>
            </div>
          </div>
        )}
        {d.contacts.length === 0 ? <Empty icon="📇" text="No external contacts" /> : (
          <ul className="divide-y divide-slate-100">
            {d.contacts.map((c: any) => (
              <li key={c.id} className="py-2.5 flex items-center gap-2">
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-700">{c.name}</div>
                  <div className="text-xs text-slate-500">{c.phone && <>📞 {c.phone} · </>}{c.email}{c.notes && ` · ${c.notes}`}</div>
                </div>
                {user.isPrimaryAdmin && <Button size="sm" variant="ghost" onClick={async () => { await api(`/vault/directory/contacts/${c.id}`, { method: 'DELETE' }); load(); }}>✕</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
