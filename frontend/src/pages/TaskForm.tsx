import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Card, Button, Input, Textarea, Select, UserPicker, FileUpload, ErrorNote, Modal, Badge } from '../components/ui';

export default function TaskForm() {
  const nav = useNavigate();
  const { id: parentId } = useParams(); // present on /tasks/:id/breakdown
  const [sp] = useSearchParams();
  const [users, setUsers] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [parent, setParent] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [videoPicker, setVideoPicker] = useState(false);
  const [vq, setVq] = useState('');

  const [f, setF] = useState<any>({
    title: '', description: '', protocol: '', priority: 'NORMAL', submissionMethod: 'TEXT',
    startDate: '', dueDate: '', dueTime: '18:00', expectedEffort: '',
    assigneeIds: [], files: [], links: [], videoIds: [], checklistItems: [],
    recurring: false, freq: 'DAILY', daysOfWeek: [1, 2, 3, 4, 5],
  });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  useEffect(() => {
    api('/users').then((d) => setUsers(d.users.filter((u: any) => u.status === 'ACTIVE')));
    api('/videos').then((d) => setVideos(d.videos)).catch(() => {});
    api('/tasks/templates/protocols').then((d) => setTemplates(d.templates)).catch(() => {});
    if (parentId) api(`/tasks/${parentId}`).then((d) => setParent(d.task)).catch(() => {});
  }, [parentId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const dueAt = f.dueDate ? new Date(`${f.dueDate}T${f.dueTime || '18:00'}:00+05:30`).toISOString() : null;
      const body: any = {
        title: f.title, description: f.description, protocol: f.protocol, priority: f.priority,
        submissionMethod: f.submissionMethod, startDate: f.startDate || null, dueAt,
        expectedEffort: f.expectedEffort || null, assigneeIds: f.assigneeIds,
        fileIds: f.files, links: f.links.filter((l: any) => l.url), videoIds: f.videoIds,
        parentTaskId: parentId || null,
        checklistItems: f.submissionMethod === 'CHECKLIST' ? f.checklistItems.filter((c: any) => c.label) : undefined,
      };
      if (f.recurring) {
        body.isRecurringTemplate = true;
        body.recurrenceRule = { freq: f.freq, daysOfWeek: f.freq === 'WEEKLY' ? f.daysOfWeek : undefined, dueTime: f.dueTime || '18:00' };
      }
      const d = await api('/tasks', { body });
      nav(`/tasks/${parentId || d.task.id}`);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  const pickedVideos = videos.filter((v) => f.videoIds.includes(v.id));

  return (
    <form onSubmit={submit} className="space-y-4 max-w-3xl">
      <h1 className="text-xl font-bold text-slate-800">{parentId ? 'Break down directive' : 'New task'}</h1>
      {parent && (
        <div className="rounded-xl bg-brand-50 border border-brand-200 px-4 py-3 text-sm">
          <div className="text-xs font-semibold text-brand-800 uppercase tracking-wide mb-0.5">Under directive (original is never altered)</div>
          <div className="font-medium text-slate-800">{parent.title}</div>
        </div>
      )}
      <ErrorNote error={err} />
      <Card>
        <div className="space-y-4">
          <Input label="Topic / title *" value={f.title} onChange={(e: any) => set('title', e.target.value)} placeholder="e.g. Worker 1: 7 photos, 7 posts, 7 videos" />
          <Textarea label="Description" value={f.description} onChange={(e: any) => set('description', e.target.value)} placeholder="What exactly needs to be done, where to submit, references…" />
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-600">Protocol — step-by-step SOP</span>
              {templates.length > 0 && (
                <select className="text-xs border border-slate-300 rounded-lg px-2 py-1" value="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) set('protocol', f.protocol ? f.protocol + '\n\n' + t.body : t.body); }}>
                  <option value="">＋ Attach template…</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              )}
            </div>
            <Textarea value={f.protocol} onChange={(e: any) => set('protocol', e.target.value)} placeholder={'1. …\n2. …\n3. …'} className="min-h-[110px] font-mono text-xs" />
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Select label="Priority" value={f.priority} onChange={(e: any) => set('priority', e.target.value)}>
              <option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="ALERT">🔴 Alert</option>
            </Select>
            <Input label="Start date" type="date" value={f.startDate} onChange={(e: any) => set('startDate', e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Input label="Deadline date" type="date" value={f.dueDate} onChange={(e: any) => set('dueDate', e.target.value)} />
              <Input label="Time (IST)" type="time" value={f.dueTime} onChange={(e: any) => set('dueTime', e.target.value)} />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Select label="Submission method (defines the form the assignee sees)" value={f.submissionMethod} onChange={(e: any) => set('submissionMethod', e.target.value)}>
              <option value="TEXT">Text answer</option><option value="FILE">File upload</option>
              <option value="LINK">External link</option><option value="CHECKLIST">Checklist</option>
            </Select>
            <Input label="Expected effort (optional)" value={f.expectedEffort} onChange={(e: any) => set('expectedEffort', e.target.value)} placeholder="e.g. ~3 hours" />
          </div>
          {f.submissionMethod === 'CHECKLIST' && (
            <div>
              <span className="block text-xs font-medium text-slate-600 mb-1">Checklist items</span>
              {f.checklistItems.map((c: any, i: number) => (
                <div key={i} className="flex gap-2 mb-1.5">
                  <input className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" value={c.label} onChange={(e) => { const n = [...f.checklistItems]; n[i] = { ...c, label: e.target.value }; set('checklistItems', n); }} placeholder={`Item ${i + 1}`} />
                  <Button type="button" size="sm" variant="ghost" onClick={() => set('checklistItems', f.checklistItems.filter((_: any, j: number) => j !== i))}>✕</Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="secondary" onClick={() => set('checklistItems', [...f.checklistItems, { id: String(Date.now()), label: '' }])}>＋ Add item</Button>
            </div>
          )}
        </div>
      </Card>

      <Card title="Resources for the assignee">
        <div className="space-y-4">
          <FileUpload files={f.files} onChange={(x: any) => set('files', x)} scope="TASK" label="Upload files (PDFs, images, docs, sheets, zips)" />
          <div>
            <span className="block text-xs font-medium text-slate-600 mb-1">External links</span>
            {f.links.map((l: any, i: number) => (
              <div key={i} className="flex gap-2 mb-1.5">
                <input className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" placeholder="https://…" value={l.url} onChange={(e) => { const n = [...f.links]; n[i] = { ...l, url: e.target.value }; set('links', n); }} />
                <Button type="button" size="sm" variant="ghost" onClick={() => set('links', f.links.filter((_: any, j: number) => j !== i))}>✕</Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="secondary" onClick={() => set('links', [...f.links, { url: '' }])}>＋ Add link</Button>
          </div>
          <div>
            <span className="block text-xs font-medium text-slate-600 mb-1">Tutorial videos from the in-app library (plays in-app, never a raw link)</span>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {pickedVideos.map((v) => (
                <Badge key={v.id} color="bg-brand-100 text-brand-800">🎬 {v.title} <button type="button" onClick={() => set('videoIds', f.videoIds.filter((x: string) => x !== v.id))}>✕</button></Badge>
              ))}
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={() => setVideoPicker(true)}>🎬 Pick from video library</Button>
          </div>
        </div>
      </Card>

      <Card title="Assignees & schedule">
        <div className="space-y-4">
          <UserPicker users={users} value={f.assigneeIds} onChange={(x: any) => set('assigneeIds', x)} label="Assignees (your team, or yourself)" />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={f.recurring} onChange={(e) => set('recurring', e.target.checked)} className="rounded" />
            Recurring task (auto-created each cycle)
          </label>
          {f.recurring && (
            <div className="grid sm:grid-cols-2 gap-3 pl-6">
              <Select label="Frequency" value={f.freq} onChange={(e: any) => set('freq', e.target.value)}>
                <option value="DAILY">Daily</option><option value="WEEKLY">Weekly (pick days)</option>
              </Select>
              {f.freq === 'WEEKLY' && (
                <div>
                  <span className="block text-xs font-medium text-slate-600 mb-1">Days</span>
                  <div className="flex gap-1">
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                      <button key={i} type="button"
                        onClick={() => set('daysOfWeek', f.daysOfWeek.includes(i + 1) ? f.daysOfWeek.filter((x: number) => x !== i + 1) : [...f.daysOfWeek, i + 1])}
                        className={`w-8 h-8 rounded-full text-xs font-bold ${f.daysOfWeek.includes(i + 1) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{d}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !f.title || (!f.assigneeIds.length && !f.recurring)}>{busy ? 'Creating…' : parentId ? 'Create child task' : 'Create & assign'}</Button>
        <Button type="button" variant="secondary" onClick={() => nav(-1)}>Cancel</Button>
      </div>

      <Modal open={videoPicker} onClose={() => setVideoPicker(false)} title="Pick tutorial videos">
        <input value={vq} onChange={(e) => setVq(e.target.value)} placeholder="Search videos…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-2" />
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
          {videos.filter((v) => (v.title + v.category).toLowerCase().includes(vq.toLowerCase())).map((v) => (
            <button key={v.id} type="button" className={`w-full text-left px-2 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2 ${f.videoIds.includes(v.id) ? 'bg-brand-50' : ''}`}
              onClick={() => set('videoIds', f.videoIds.includes(v.id) ? f.videoIds.filter((x: string) => x !== v.id) : [...f.videoIds, v.id])}>
              <span className="flex-1">🎬 {v.title} <span className="text-xs text-slate-400">· {v.category}</span></span>
              {f.videoIds.includes(v.id) && <span className="text-brand-600 font-bold">✓</span>}
            </button>
          ))}
          {!videos.length && <div className="text-sm text-slate-400 p-3">Library is empty — the Primary Admin adds videos in Training.</div>}
        </div>
        <div className="mt-3 text-right"><Button type="button" size="sm" onClick={() => setVideoPicker(false)}>Done</Button></div>
      </Modal>
    </form>
  );
}
