import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Button, Badge, PageLoader, Empty, Modal, Input, Select, ErrorNote, Avatar } from '../components/ui';

export default function People() {
  const { user } = useAuth();
  const [tree, setTree] = useState<any>(null);
  const [showExited, setShowExited] = useState(false);
  const [create, setCreate] = useState(false);

  const load = () => api('/users/tree').then(setTree);
  useEffect(() => { load(); }, []);
  if (!tree) return <PageLoader />;

  const users = tree.users.filter((u: any) => showExited || u.status === 'ACTIVE');
  const childrenOf = (id: string | null) => users.filter((u: any) => (id === null ? !tree.users.some((x: any) => x.id === u.managerId) : u.managerId === id));

  const Node = ({ u, depth }: { u: any; depth: number }) => (
    <div>
      <Link to={`/people/${u.id}`} className="flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-slate-50" style={{ marginLeft: depth * 22 }}>
        {depth > 0 && <span className="text-slate-300">└</span>}
        <Avatar name={u.name} size={8} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-800 truncate">
            {u.name} {u.isPrimaryAdmin && <Badge color="bg-brand-700 text-white">Primary Admin</Badge>}
            {u.status === 'EXITED' && <Badge color="bg-slate-200 text-slate-500">Exited</Badge>}
          </div>
          <div className="text-xs text-slate-400 truncate">@{u.username}{u.department ? ` · ${u.department}` : ''}{childrenOf(u.id).length ? ` · heads ${childrenOf(u.id).length}` : ''}</div>
        </div>
      </Link>
      {childrenOf(u.id).map((c: any) => <Node key={c.id} u={c} depth={depth + 1} />)}
    </div>
  );

  const roots = tree.rootId ? users.filter((u: any) => u.id === tree.rootId) : users.filter((u: any) => !u.managerId || !tree.users.some((x: any) => x.id === u.managerId));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">People & org tree</h1>
        <div className="flex gap-2 items-center">
          <label className="text-xs text-slate-500 flex items-center gap-1.5"><input type="checkbox" checked={showExited} onChange={(e) => setShowExited(e.target.checked)} className="rounded" /> Show exited</label>
          {user.isPrimaryAdmin && <Button size="sm" onClick={() => setCreate(true)}>＋ Add person</Button>}
        </div>
      </div>
      <Card>
        {roots.length === 0 ? <Empty text="No people visible" /> : roots.map((r: any) => <Node key={r.id} u={r} depth={0} />)}
      </Card>
      {create && <CreateUserModal onClose={() => { setCreate(false); load(); }} allUsers={tree.users} />}
    </div>
  );
}

export function CreateUserModal({ onClose, allUsers }: any) {
  const [f, setF] = useState<any>({ name: '', username: '', email: '', phone: '', password: '', managerId: '', department: '', roleNotes: '', dateOfJoining: '', stipendAmount: '', payDay: 5 });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  async function genPw() {
    const d = await api('/auth/generate-password');
    set('password', d.password);
  }
  async function submit() {
    setBusy(true); setErr('');
    try {
      await api('/users', { body: { ...f, managerId: f.managerId || null, stipendAmount: f.stipendAmount || null } });
      onClose();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} title="Add person (invitation-only — you set their password)" wide>
      <ErrorNote error={err} />
      <div className="grid sm:grid-cols-2 gap-3">
        <Input label="Full name *" value={f.name} onChange={(e: any) => set('name', e.target.value)} />
        <Input label="Username *" value={f.username} onChange={(e: any) => set('username', e.target.value.toLowerCase())} />
        <Input label="Email *" type="email" value={f.email} onChange={(e: any) => set('email', e.target.value)} />
        <Input label="Phone * (feeds the directory)" value={f.phone} onChange={(e: any) => set('phone', e.target.value)} />
        <div className="sm:col-span-2 flex gap-2 items-end">
          <div className="flex-1"><Input label="Password * (min 8 chars)" value={f.password} onChange={(e: any) => set('password', e.target.value)} /></div>
          <Button variant="secondary" size="md" onClick={genPw}>🎲 Generate strong</Button>
        </div>
        <Select label="Reports to (manager)" value={f.managerId} onChange={(e: any) => set('managerId', e.target.value)}>
          <option value="">— none (top level) —</option>
          {allUsers.filter((u: any) => u.status === 'ACTIVE').map((u: any) => <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>)}
        </Select>
        <Input label="Department label" value={f.department} onChange={(e: any) => set('department', e.target.value)} placeholder="e.g. Marketing" />
        <Input label="Date of joining" type="date" value={f.dateOfJoining} onChange={(e: any) => set('dateOfJoining', e.target.value)} />
        <Input label="Role notes" value={f.roleNotes} onChange={(e: any) => set('roleNotes', e.target.value)} />
        <Input label="Stipend / salary (₹ per month)" type="number" value={f.stipendAmount} onChange={(e: any) => set('stipendAmount', e.target.value)} />
        <Input label="Pay day (1–28)" type="number" min={1} max={28} value={f.payDay} onChange={(e: any) => set('payDay', e.target.value)} />
      </div>
      <div className="flex gap-2 mt-4">
        <Button onClick={submit} disabled={busy || !f.name || !f.username || !f.email || !f.phone || f.password.length < 8}>Create account</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">Share the username & password with the person directly. There is no public signup and no self-service reset.</p>
    </Modal>
  );
}
