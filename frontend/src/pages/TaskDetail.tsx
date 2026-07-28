import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, openFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Button, Badge, StatusBadge, PriorityBadge, PageLoader, Textarea, ErrorNote, Modal, Avatar, Input, FileUpload } from '../components/ui';
import { fmt, fmtTime, ago } from '../lib/format';

export default function TaskDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, isHead } = useAuth();
  const [t, setT] = useState<any>(null);
  const [err, setErr] = useState('');
  const [comment, setComment] = useState('');
  const [sub, setSub] = useState<any>({ content: '', linkUrl: '', files: [], checklistState: {} });
  const [review, setReview] = useState<any>(null); // {submissionId, result}
  const [reviewNote, setReviewNote] = useState('');
  const [queryModal, setQueryModal] = useState(false);
  const [query, setQuery] = useState({ title: '', body: '', level: 'NORMAL' });

  const load = async () => {
    try {
      const d = await api(`/tasks/${id}`);
      setT(d.task);
      api(`/tasks/${id}/open`, { method: 'POST', body: {} }).catch(() => {}); // read receipt
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { setT(null); load(); }, [id]);

  if (err && !t) return <div className="max-w-lg mx-auto mt-10"><Card><div className="text-center py-6"><div className="text-3xl mb-2">🔒</div><div className="text-slate-600">{err}</div></div></Card></div>;
  if (!t) return <PageLoader />;

  const me = t.assignees.find((a: any) => a.userId === user.id);
  const mySubmissions = t.submissions.filter((s: any) => s.userId === user.id);
  const canSubmit = me && !['APPROVED'].includes(me.status);
  const name = (uid: string) => t.names[uid]?.name || '—';

  async function postComment() {
    if (!comment.trim()) return;
    await api(`/tasks/${id}/comments`, { body: { body: comment } });
    setComment(''); load();
  }
  async function submitWork() {
    setErr('');
    try {
      await api(`/tasks/${id}/submit`, {
        body: {
          content: sub.content || null, linkUrl: sub.linkUrl || null,
          fileIds: sub.files, checklistState: t.submissionMethod === 'CHECKLIST' ? sub.checklistState : undefined,
        },
      });
      setSub({ content: '', linkUrl: '', files: [], checklistState: {} });
      load();
    } catch (e: any) { setErr(e.message); }
  }
  async function doReview() {
    setErr('');
    try {
      await api(`/tasks/${id}/review`, { body: { submissionId: review.submissionId, result: review.result, note: reviewNote } });
      setReview(null); setReviewNote(''); load();
    } catch (e: any) { setErr(e.message); }
  }
  async function raiseQuery() {
    setErr('');
    try {
      const d = await api('/queries', { body: { ...query, taskId: id } });
      setQueryModal(false); nav(`/queries/${d.query.id}`);
    } catch (e: any) { setErr(e.message); }
  }

  const FileUploadLazy = FileUpload;

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Header */}
      <div>
        {t.parentTask && (
          <div className="text-xs text-slate-500 mb-1">
            ↳ Part of directive:{' '}
            {t.parentTask.restricted ? <span className="italic">{t.parentTask.title}</span> : <Link to={`/tasks/${t.parentTask.id}`} className="text-brand-700 font-medium">{t.parentTask.title}</Link>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge p={t.priority} />
          <h1 className="text-xl font-bold text-slate-800 flex-1 min-w-[200px]">{t.title}</h1>
          {(isHead || user.isPrimaryAdmin) && me && <Link to={`/tasks/${id}/breakdown`}><Button size="sm" variant="secondary">🔀 Break down</Button></Link>}
          <Button size="sm" variant="secondary" onClick={() => setQueryModal(true)}>💬 Raise query</Button>
        </div>
        <div className="text-sm text-slate-500 mt-1">
          {t.dueAt && <>Deadline <b className={new Date(t.dueAt) < new Date() ? 'text-rose-600' : 'text-slate-700'}>{fmt(t.dueAt)}</b> · </>}
          {t.expectedEffort && <>~{t.expectedEffort} · </>}
          Created by <b>{name(t.createdById)}</b> {ago(t.createdAt)}
        </div>
      </div>
      <ErrorNote error={err} />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {t.description && <Card title="Description"><p className="text-sm text-slate-700 whitespace-pre-wrap">{t.description}</p></Card>}
          {t.protocol && (
            <Card title="📋 Protocol (how this must be done)">
              <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans bg-slate-50 rounded-lg p-3">{t.protocol}</pre>
            </Card>
          )}

          {/* Resources */}
          {(t.resources.length > 0 || t.videos.length > 0) && (
            <Card title="Resources">
              <ul className="space-y-2">
                {t.resources.filter((r: any) => r.type === 'FILE').map((r: any) => (
                  <li key={r.id}><button onClick={() => openFile(r.fileId)} className="text-sm text-brand-700 hover:underline">📄 {r.label || 'Attached file'}</button></li>
                ))}
                {t.resources.filter((r: any) => r.type === 'LINK').map((r: any) => (
                  <li key={r.id}><a href={r.url} target="_blank" rel="noreferrer" className="text-sm text-brand-700 hover:underline">🔗 {r.label || r.url}</a></li>
                ))}
                {t.videos.map((v: any) => {
                  const watchers = t.videoWatches.filter((w: any) => w.videoId === v.id).map((w: any) => w.userId);
                  return (
                    <li key={v.id} className="flex flex-wrap items-center gap-2">
                      <Link to={`/videos/${v.id}`} className="text-sm text-brand-700 hover:underline">🎬 {v.title} <span className="text-xs text-slate-400">({v.category}) — plays in-app</span></Link>
                      {t.canReview && t.assignees.map((a: any) => (
                        <Badge key={a.userId} color={watchers.includes(a.userId) ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}>
                          {a.user.name.split(' ')[0]} {watchers.includes(a.userId) ? '✓ watched' : 'not watched'}
                        </Badge>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {/* My submission form */}
          {canSubmit && (
            <Card title={me.status === 'RETURNED' ? '↩ Returned — resubmit your work' : 'Submit your work'}>
              <div className="space-y-3">
                {t.submissionMethod === 'TEXT' && <Textarea label="Your answer" value={sub.content} onChange={(e: any) => setSub({ ...sub, content: e.target.value })} />}
                {t.submissionMethod === 'LINK' && <Input label="Link to your work (Drive, Figma, …)" value={sub.linkUrl} onChange={(e: any) => setSub({ ...sub, linkUrl: e.target.value })} placeholder="https://…" />}
                {t.submissionMethod === 'CHECKLIST' && (
                  <div className="space-y-1.5">
                    {(t.checklistItems || []).map((c: any) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" className="rounded" checked={!!sub.checklistState[c.id]} onChange={(e) => setSub({ ...sub, checklistState: { ...sub.checklistState, [c.id]: e.target.checked } })} />
                        {c.label}
                      </label>
                    ))}
                  </div>
                )}
                {(t.submissionMethod === 'FILE' || true) && (
                  <FileUploadLazy files={sub.files} onChange={(x: any) => setSub({ ...sub, files: x })} scope="TASK" label={t.submissionMethod === 'FILE' ? 'Upload your deliverables *' : 'Attach files (optional)'} />
                )}
                {t.submissionMethod !== 'TEXT' && <Textarea label="Note (optional)" value={sub.content} onChange={(e: any) => setSub({ ...sub, content: e.target.value })} className="min-h-[60px]" />}
                <Button onClick={submitWork} disabled={t.submissionMethod === 'FILE' && !sub.files.length}>Submit{t.dueAt && new Date(t.dueAt) < new Date() ? ' (will be marked LATE)' : ''}</Button>
              </div>
            </Card>
          )}

          {/* Submissions & review loop */}
          {t.submissions.length > 0 && (
            <Card title="Submissions">
              <div className="space-y-3">
                {t.submissions.map((s: any) => (
                  <div key={s.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <Avatar name={name(s.userId)} size={6} />
                      <b className="text-slate-700">{name(s.userId)}</b> · attempt {s.attempt} · {fmt(s.submittedAt)}
                      {t.dueAt && new Date(s.submittedAt) > new Date(t.dueAt) && <Badge color="bg-rose-100 text-rose-700">LATE</Badge>}
                      <span className="ml-auto"><StatusBadge status={s.reviewStatus === 'PENDING' ? 'UNDER_REVIEW' : s.reviewStatus} /></span>
                    </div>
                    {s.content && <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{s.content}</p>}
                    {s.linkUrl && <a href={s.linkUrl} target="_blank" rel="noreferrer" className="text-sm text-brand-700 hover:underline block mt-1">🔗 {s.linkUrl}</a>}
                    {s.checklistState && (t.checklistItems || []).length > 0 && (
                      <ul className="mt-2 text-sm space-y-0.5">{(t.checklistItems || []).map((c: any) => <li key={c.id}>{s.checklistState[c.id] ? '✅' : '⬜'} {c.label}</li>)}</ul>
                    )}
                    {s.files?.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {s.files.map((fl: any) => <button key={fl.id} onClick={() => openFile(fl.fileId)} className="text-xs bg-slate-100 hover:bg-slate-200 rounded px-2 py-1">📄 {fl.name}</button>)}
                      </div>
                    )}
                    {s.reviewNote && <div className="mt-2 text-xs bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 text-amber-800"><b>Review note ({name(s.reviewedById)}):</b> {s.reviewNote}</div>}
                    {t.canReview && s.reviewStatus === 'PENDING' && s.userId !== user.id && (
                      <div className="flex gap-2 mt-2.5">
                        <Button size="sm" onClick={() => { setReview({ submissionId: s.id, result: 'APPROVED' }); }}>✓ Approve</Button>
                        <Button size="sm" variant="danger" onClick={() => setReview({ submissionId: s.id, result: 'RETURNED' })}>↩ Return for rework</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Comments */}
          <Card title="Comments">
            <div className="space-y-3 mb-3">
              {t.comments.map((c: any) => (
                <div key={c.id} className="flex gap-2.5">
                  <Avatar name={name(c.authorId)} size={7} />
                  <div className="flex-1 bg-slate-50 rounded-lg px-3 py-2">
                    <div className="text-xs text-slate-500"><b className="text-slate-700">{name(c.authorId)}</b> · {ago(c.createdAt)}</div>
                    <div className="text-sm text-slate-700 whitespace-pre-wrap">{c.body}</div>
                  </div>
                </div>
              ))}
              {!t.comments.length && <div className="text-xs text-slate-400">No comments yet. Use @username to mention someone.</div>}
            </div>
            <div className="flex gap-2">
              <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && postComment()} placeholder="Write a comment… use @username to mention" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <Button size="sm" onClick={postComment}>Send</Button>
            </div>
          </Card>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <Card title="Assignees & read receipts">
            <ul className="space-y-2.5">
              {t.assignees.map((a: any) => (
                <li key={a.userId} className="flex items-center gap-2">
                  <Avatar name={a.user.name} size={7} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-700 truncate">{a.user.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {a.firstOpenedAt ? `👁 Opened at ${fmtTime(a.firstOpenedAt)}` : 'Not opened yet'}
                    </div>
                  </div>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
            {me && me.status === 'OPENED' && (
              <Button size="sm" variant="secondary" className="mt-3 w-full" onClick={async () => { await api(`/tasks/${id}/status`, { body: { status: 'IN_PROGRESS' } }); load(); }}>▶ Mark in progress</Button>
            )}
          </Card>

          {t.childTasks.length > 0 && (
            <Card title="Breakdown (child tasks)">
              <ul className="space-y-2">
                {t.childTasks.map((c: any) => (
                  <li key={c.id}>
                    <Link to={`/tasks/${c.id}`} className="block rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50">
                      <div className="text-sm font-medium text-slate-700">{c.title}</div>
                      <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap gap-1">
                        {c.assignees.map((a: any) => <span key={a.userId}><StatusBadge status={a.status} /> {a.name}</span>)}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="History">
            <ul className="space-y-1.5 max-h-72 overflow-y-auto">
              {t.history.map((h: any) => (
                <li key={h.id} className="text-xs text-slate-500">
                  <b className="text-slate-600">{name(h.actorId)}</b> {h.action.toLowerCase()} · {fmt(h.createdAt)}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {/* Review modal */}
      <Modal open={!!review} onClose={() => setReview(null)} title={review?.result === 'APPROVED' ? 'Approve submission' : 'Return for rework'}>
        <Textarea label={review?.result === 'APPROVED' ? 'Note (optional)' : 'What must be fixed? (mandatory)'} value={reviewNote} onChange={(e: any) => setReviewNote(e.target.value)} autoFocus />
        <div className="flex gap-2 mt-4">
          <Button variant={review?.result === 'APPROVED' ? 'primary' : 'danger'} onClick={doReview} disabled={review?.result === 'RETURNED' && !reviewNote.trim()}>
            {review?.result === 'APPROVED' ? '✓ Approve' : '↩ Return'}
          </Button>
          <Button variant="secondary" onClick={() => setReview(null)}>Cancel</Button>
        </div>
      </Modal>

      {/* Raise query modal */}
      <Modal open={queryModal} onClose={() => setQueryModal(false)} title="Raise a query to your head">
        <div className="space-y-3">
          <Input label="Title *" value={query.title} onChange={(e: any) => setQuery({ ...query, title: e.target.value })} />
          <Textarea label="Details" value={query.body} onChange={(e: any) => setQuery({ ...query, body: e.target.value })} />
          <div className="flex gap-2">
            {['NORMAL', 'ALERT', 'LATER'].map((l) => (
              <button key={l} onClick={() => setQuery({ ...query, level: l })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${query.level === l ? (l === 'ALERT' ? 'bg-rose-600 text-white border-rose-600' : 'bg-brand-700 text-white border-brand-700') : 'border-slate-300 text-slate-600'}`}>
                {l === 'ALERT' ? '🔴 Alert (urgent)' : l === 'LATER' ? 'Solve later' : 'Normal'}
              </button>
            ))}
          </div>
          <Button onClick={raiseQuery} disabled={!query.title.trim()}>Raise query</Button>
        </div>
      </Modal>
    </div>
  );
}
