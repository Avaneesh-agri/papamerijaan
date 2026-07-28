import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Button, Badge, StatusBadge, PageLoader, Textarea, Modal, ErrorNote, Avatar } from '../components/ui';
import { fmt, ago } from '../lib/format';

export default function QueryDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [action, setAction] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = () => api(`/queries/${id}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);

  if (err && !d) return <div className="max-w-lg mx-auto mt-10"><Card><div className="text-center py-6"><div className="text-3xl mb-2">🔒</div>{err}</div></Card></div>;
  if (!d) return <PageLoader />;
  const q = d.query;
  const uname = (uid: string) => d.users[uid]?.name || '—';

  async function send() {
    if (!msg.trim()) return;
    await api(`/queries/${id}/messages`, { body: { body: msg } });
    setMsg(''); load();
  }
  async function act() {
    setErr('');
    try {
      await api(`/queries/${id}/action`, { body: { action, note } });
      setAction(null); setNote(''); load();
    } catch (e: any) { setErr(e.message); }
  }

  const kindStyle: any = {
    ANSWER: 'bg-emerald-50 border-emerald-200', ESCALATE: 'bg-amber-50 border-amber-200',
    PARK: 'bg-slate-50 border-slate-200', RESOLVE: 'bg-brand-50 border-brand-200', MESSAGE: 'bg-white border-slate-200',
  };
  const kindLabel: any = { ANSWER: '✅ Answer', ESCALATE: '⬆ Escalated', PARK: '⏸ Parked', RESOLVE: '✔ Resolution' };

  return (
    <div className="max-w-3xl space-y-4">
      <div className={`rounded-xl p-4 ${q.level === 'ALERT' && q.status !== 'RESOLVED' ? 'bg-rose-600 text-white' : 'bg-white border border-slate-200'}`}>
        <div className="flex flex-wrap items-center gap-2">
          {q.level === 'ALERT' && <Badge color={q.status !== 'RESOLVED' ? 'bg-white text-rose-600' : 'bg-rose-100 text-rose-700'}>🔴 ALERT</Badge>}
          {q.level === 'LATER' && <Badge color="bg-slate-200 text-slate-600">Solve later</Badge>}
          <h1 className="text-lg font-bold flex-1">{q.title}</h1>
          <StatusBadge status={q.status} />
        </div>
        <div className={`text-xs mt-1 ${q.level === 'ALERT' && q.status !== 'RESOLVED' ? 'text-rose-100' : 'text-slate-400'}`}>
          Raised by {uname(q.raisedById)} {ago(q.createdAt)} · currently with <b>{uname(q.assignedToId)}</b>
          {q.escalations > 0 && ` · escalated ${q.escalations}×`}
          {d.task && <> · on task <Link to={`/tasks/${d.task.id}`} className="underline">{d.task.title}</Link></>}
        </div>
      </div>

      {/* Escalation trail + thread */}
      <Card title="Thread & escalation trail">
        <div className="space-y-2.5">
          {q.messages.map((m: any) => (
            <div key={m.id} className={`rounded-lg border px-3 py-2 ${kindStyle[m.kind] || kindStyle.MESSAGE}`}>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Avatar name={uname(m.authorId)} size={5} />
                <b className="text-slate-700">{uname(m.authorId)}</b>
                {kindLabel[m.kind] && <Badge color="bg-white/70 text-slate-700">{kindLabel[m.kind]}</Badge>}
                {m.kind === 'ESCALATE' && m.meta && <span className="text-amber-700">{m.meta.fromName} → {m.meta.toName}</span>}
                <span className="ml-auto">{fmt(m.createdAt)}</span>
              </div>
              <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
          {!q.messages.length && <div className="text-xs text-slate-400">No messages yet</div>}
        </div>
        {q.status !== 'RESOLVED' && (
          <div className="flex gap-2 mt-3">
            <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Reply…" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <Button size="sm" onClick={send}>Send</Button>
          </div>
        )}
      </Card>

      {q.resolutionNote && (
        <Card title="Resolution"><p className="text-sm text-slate-700">✅ {q.resolutionNote}</p><p className="text-xs text-slate-400 mt-1">by {uname(q.resolvedById)} · {fmt(q.resolvedAt)}</p></Card>
      )}

      {d.canAct && q.status !== 'RESOLVED' && (
        <Card title="Actions (you hold this query)">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setAction('ANSWER')}>✅ Answer</Button>
            {q.status !== 'PARKED' ? <Button size="sm" variant="secondary" onClick={() => setAction('PARK')}>⏸ Park for later</Button>
              : <Button size="sm" variant="secondary" onClick={async () => { await api(`/queries/${id}/action`, { body: { action: 'REVIVE' } }); load(); }}>▶ Revive</Button>}
            <Button size="sm" variant="secondary" onClick={() => setAction('ESCALATE')}>⬆ Escalate one level up</Button>
            <Button size="sm" variant="danger" onClick={() => setAction('RESOLVE')}>✔ Resolve & close</Button>
          </div>
        </Card>
      )}

      <Modal open={!!action} onClose={() => setAction(null)} title={{ ANSWER: 'Write the answer', PARK: 'Park for later', ESCALATE: 'Escalate one level up', RESOLVE: 'Resolve — note required' }[action || 'ANSWER']}>
        <ErrorNote error={err} />
        <Textarea value={note} onChange={(e: any) => setNote(e.target.value)} autoFocus label={action === 'RESOLVE' ? 'Resolution note (mandatory)' : 'Note'} />
        <div className="flex gap-2 mt-3">
          <Button onClick={act} disabled={(action === 'RESOLVE' || action === 'ANSWER') && !note.trim()}>Confirm</Button>
          <Button variant="secondary" onClick={() => setAction(null)}>Cancel</Button>
        </div>
      </Modal>
    </div>
  );
}
