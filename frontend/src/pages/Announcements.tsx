import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Button, Badge, PageLoader, Empty, Modal, Input, Textarea, ErrorNote } from '../components/ui';
import { fmt } from '../lib/format';

export default function Announcements() {
  const { user } = useAuth();
  const [list, setList] = useState<any[] | null>(null);
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ title: '', body: '' });
  const [err, setErr] = useState('');

  const load = () => api('/announcements').then((d) => {
    setList(d.announcements);
    d.announcements.filter((a: any) => !a.readByMe).forEach((a: any) => api(`/announcements/${a.id}/read`, { method: 'POST', body: {} }).catch(() => {}));
  });
  useEffect(() => { load(); }, []);
  if (!list) return <PageLoader />;

  async function post() {
    setErr('');
    try { await api('/announcements', { body: f }); setAdd(false); setF({ title: '', body: '' }); load(); }
    catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">📢 Announcements</h1>
        {user.isPrimaryAdmin && <Button size="sm" onClick={() => setAdd(true)}>＋ Post</Button>}
      </div>
      {list.length === 0 ? <Card><Empty icon="📢" text="No announcements yet" /></Card> : list.map((a) => (
        <Card key={a.id}>
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-bold text-slate-800">{a.title}</h2>
            {!a.readByMe && <Badge color="bg-brand-100 text-brand-800">New</Badge>}
          </div>
          <p className="text-sm text-slate-700 whitespace-pre-wrap mt-1.5">{a.body}</p>
          <div className="text-xs text-slate-400 mt-2 flex justify-between">
            <span>{fmt(a.createdAt)}</span>
            {user.isPrimaryAdmin && <span>👁 Read by {a.readCount}/{a.totalUsers}</span>}
          </div>
        </Card>
      ))}
      <Modal open={add} onClose={() => setAdd(false)} title="Post company-wide announcement">
        <ErrorNote error={err} />
        <div className="space-y-3">
          <Input label="Title *" value={f.title} onChange={(e: any) => setF({ ...f, title: e.target.value })} />
          <Textarea label="Message *" value={f.body} onChange={(e: any) => setF({ ...f, body: e.target.value })} />
          <Button onClick={post} disabled={!f.title || !f.body}>Post (everyone gets notified, reads are tracked)</Button>
        </div>
      </Modal>
    </div>
  );
}
