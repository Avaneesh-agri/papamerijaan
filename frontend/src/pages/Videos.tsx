import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Button, Badge, PageLoader, Empty, Modal, Input, Textarea, ErrorNote } from '../components/ui';

export default function Videos() {
  const { user } = useAuth();
  const [videos, setVideos] = useState<any[] | null>(null);
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ title: '', category: '', description: '', driveLink: '' });
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');

  const load = () => api('/videos').then((d) => setVideos(d.videos));
  useEffect(() => { load(); }, []);
  if (!videos) return <PageLoader />;

  const cats = [...new Set(videos.map((v) => v.category))];
  const filtered = videos.filter((v) => (v.title + v.category + (v.description || '')).toLowerCase().includes(q.toLowerCase()));

  async function submit() {
    setErr('');
    try { await api('/videos', { body: f }); setAdd(false); setF({ title: '', category: '', description: '', driveLink: '' }); load(); }
    catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">Training library</h1>
        {user.isPrimaryAdmin && <Button size="sm" onClick={() => setAdd(true)}>＋ Add video</Button>}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search videos…" className="w-full sm:max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white" />
      {cats.length === 0 && <Card><Empty icon="🎬" text="Library is empty — the Primary Admin adds tutorial videos here" /></Card>}
      {cats.map((cat) => {
        const items = filtered.filter((v) => v.category === cat);
        if (!items.length) return null;
        return (
          <div key={cat}>
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-2">{cat}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map((v) => (
                <Link key={v.id} to={`/videos/${v.id}`} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 hover:shadow transition">
                  <div className="w-full aspect-video rounded-lg bg-slate-900 flex items-center justify-center text-3xl mb-2.5">▶️</div>
                  <div className="text-sm font-semibold text-slate-800">{v.title}</div>
                  {v.description && <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{v.description}</div>}
                  <div className="mt-1.5">{v.watchedByMe ? <Badge color="bg-emerald-100 text-emerald-700">✓ Watched</Badge> : <Badge>Not watched yet</Badge>}</div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
      <Modal open={add} onClose={() => setAdd(false)} title="Add training video">
        <ErrorNote error={err} />
        <div className="space-y-3">
          <Input label="Title *" value={f.title} onChange={(e: any) => setF({ ...f, title: e.target.value })} />
          <Input label="Category *" value={f.category} onChange={(e: any) => setF({ ...f, category: e.target.value })} placeholder="e.g. LinkedIn posting" list="cats" />
          <datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          <Textarea label="Description" value={f.description} onChange={(e: any) => setF({ ...f, description: e.target.value })} />
          <Input label="Google Drive link *" value={f.driveLink} onChange={(e: any) => setF({ ...f, driveLink: e.target.value })} placeholder="https://drive.google.com/file/d/…/view" />
          <p className="text-[11px] text-slate-400">The Drive link is stored server-side only — viewers never see it. Set the Drive file itself to “Viewer” with download disabled for full effect.</p>
          <Button onClick={submit} disabled={!f.title || !f.category || !f.driveLink}>Add to library</Button>
        </div>
      </Modal>
    </div>
  );
}
