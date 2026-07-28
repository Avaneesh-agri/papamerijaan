import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, openFile, downloadUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Tabs, Button, Badge, StatusBadge, PriorityBadge, PageLoader, Empty, Textarea, FileUpload, ErrorNote, Avatar } from '../components/ui';
import { fmt, fmtDate, fmtTime, todayKey } from '../lib/format';

export default function Reports() {
  const { user, isHead } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'my';
  const date = sp.get('date') || todayKey();
  const setTab = (t: string) => setSp({ tab: t, date });
  const setDate = (d: string) => setSp({ tab, date: d });

  const tabs = [
    { key: 'my', label: 'My report' },
    ...(isHead || user.isPrimaryAdmin ? [{ key: 'team', label: 'Team reports' }] : []),
    ...(user.isPrimaryAdmin ? [{ key: 'day', label: 'Company day view' }, { key: 'archive', label: 'PDF archive' }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">Daily reports</h1>
        <input type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white" />
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'my' && <MyReport date={date} />}
      {tab === 'team' && <TeamReports date={date} />}
      {tab === 'day' && <DayView date={date} />}
      {tab === 'archive' && <Archive />}
    </div>
  );
}

function MyReport({ date }: { date: string }) {
  const [d, setD] = useState<any>(null);
  const [summary, setSummary] = useState('');
  const [blockers, setBlockers] = useState('');
  const [files, setFiles] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<any>(null);

  useEffect(() => {
    setD(null); setDone(null);
    api(`/reports/my?date=${date}`).then((x) => {
      setD(x);
      setSummary(x.report?.summary || ''); setBlockers(x.report?.blockers || '');
    });
  }, [date]);
  if (!d) return <PageLoader />;

  const submitted = d.report && d.report.status !== 'DRAFT';

  async function submit() {
    setErr('');
    try {
      const r = await api('/reports/my', { body: { date, summary, blockers, fileIds: files } });
      setDone(r); setFiles([]);
      setD({ ...d, report: r.report });
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title={`Tasks on ${fmtDate(date)}`}>
        {d.offDay.neutral && <Badge color="bg-amber-100 text-amber-800" className="mb-2">{d.offDay.label}</Badge>}
        {d.tasks.length === 0 ? <Empty icon="✨" text="No tasks were due" /> : (
          <ul className="divide-y divide-slate-100">
            {d.tasks.map((t: any) => (
              <li key={t.taskId}>
                <Link to={`/tasks/${t.taskId}`} className="flex items-center gap-2 py-2">
                  <PriorityBadge p={t.priority} />
                  <span className="flex-1 text-sm truncate">{t.title}</span>
                  <StatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={submitted ? `Report ${d.report.late ? '(submitted LATE)' : 'submitted'}` : `File report — due by ${d.eodTime} IST`}>
        <ErrorNote error={err} />
        {done && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2 mb-3">Report submitted{done.late ? ' — flagged LATE' : ' on time'} ✓</div>}
        <div className="space-y-3">
          <Textarea label="Summary of the day" value={summary} onChange={(e: any) => setSummary(e.target.value)} placeholder="What you did, what got finished…" />
          <Textarea label="Blockers (if any)" value={blockers} onChange={(e: any) => setBlockers(e.target.value)} className="min-h-[60px]" />
          <FileUpload files={files} onChange={setFiles} scope="REPORT" label="Attach proof of work / deliverables (multiple allowed)" />
          {d.report?.attachments?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {d.report.attachments.map((a: any) => <button key={a.id} onClick={() => openFile(a.fileId)} className="text-xs bg-slate-100 rounded px-2 py-1">📄 {a.name}</button>)}
            </div>
          )}
          {d.report?.managerComment && <div className="text-xs bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 text-amber-800"><b>Manager:</b> {d.report.managerComment}</div>}
          <Button onClick={submit} disabled={d.report?.status === 'FORWARDED'}>
            {d.report?.status === 'FORWARDED' ? 'Forwarded up the chain ✓' : submitted ? 'Update report' : 'Submit to my manager'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function TeamReports({ date }: { date: string }) {
  const [d, setD] = useState<any>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [compileSummary, setCompileSummary] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => api(`/reports/team?date=${date}`).then(setD);
  useEffect(() => { setD(null); load(); }, [date]);
  if (!d) return <PageLoader />;

  async function review(id: string) {
    await api(`/reports/${id}/review`, { body: { comment: note[id] || '' } });
    setMsg('Reviewed ✓'); load();
  }
  async function compile() {
    const r = await api('/reports/compile', { body: { date, summary: compileSummary || undefined } });
    setMsg(`Compiled & forwarded (${r.included} team reports included) ✓`);
    load();
  }

  return (
    <div className="space-y-4">
      {msg && <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2">{msg}</div>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {d.rows.map((row: any) => (
          <Card key={row.user.id}>
            <div className="flex items-center gap-2 mb-2">
              <Avatar name={row.user.name} size={8} />
              <div className="flex-1">
                <Link to={`/people/${row.user.id}`} className="text-sm font-semibold text-slate-800">{row.user.name}</Link>
                <div className="flex gap-1 mt-0.5">
                  {row.offDay.neutral ? <Badge color="bg-amber-100 text-amber-800">{row.offDay.label}</Badge> :
                    row.report ? <><StatusBadge status={row.report.status} />{row.report.late && <Badge color="bg-rose-600 text-white">LATE</Badge>}</> :
                    <Badge color="bg-slate-100 text-slate-500">Report missing</Badge>}
                </div>
              </div>
            </div>
            {row.report?.summary && <p className="text-sm text-slate-700 whitespace-pre-wrap mb-2">{row.report.summary}</p>}
            {row.report?.blockers && <p className="text-xs text-rose-600 mb-2"><b>Blockers:</b> {row.report.blockers}</p>}
            {row.report?.attachments?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {row.report.attachments.map((a: any) => <button key={a.id} onClick={() => openFile(a.fileId)} className="text-xs bg-slate-100 hover:bg-slate-200 rounded px-2 py-1">📄 {a.name}</button>)}
              </div>
            )}
            <div className="text-xs text-slate-400 mb-2">{row.tasks.length} tasks due · {row.tasks.filter((t: any) => ['SUBMITTED', 'APPROVED'].includes(t.status)).length} submitted</div>
            {row.report && row.report.status === 'SUBMITTED' && (
              <div className="flex gap-2">
                <input value={note[row.report.id] || ''} onChange={(e) => setNote({ ...note, [row.report.id]: e.target.value })} placeholder="Comment…" className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs" />
                <Button size="sm" onClick={() => review(row.report.id)}>✓ Review</Button>
              </div>
            )}
            {row.report?.managerComment && <div className="text-xs text-slate-500 mt-1">💬 {row.report.managerComment}</div>}
          </Card>
        ))}
        {!d.rows.length && <Empty text="No direct reports" />}
      </div>
      <Card title="Compile & forward to my manager">
        <p className="text-xs text-slate-500 mb-2">Bundles the team roll-up above plus your own report and sends it one level up. This repeats up the chain to the Primary Admin.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={compileSummary} onChange={(e) => setCompileSummary(e.target.value)} placeholder="Your own summary for the bundle (optional if already filed)" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <Button onClick={compile}>📤 Compile & forward</Button>
        </div>
        {d.myReport?.status === 'FORWARDED' && <div className="text-xs text-emerald-600 mt-2">Already forwarded for {fmtDate(date)} ✓ (you can re-forward to update)</div>}
      </Card>
    </div>
  );
}

function DayView({ date }: { date: string }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { setD(null); api(`/reports/day?date=${date}`).then(setD); }, [date]);
  if (!d) return <PageLoader />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => downloadUrl(`/reports/day-pdf?date=${date}`, `Asscher-AI-Day-Report-${date}.pdf`)}>⬇ Download Day Report (PDF)</Button>
        <Button size="sm" variant="secondary" onClick={() => downloadUrl(`/reports/day-csv?date=${date}`, `Asscher-AI-Day-${date}.csv`)}>⬇ CSV</Button>
        <Button size="sm" variant="secondary" onClick={() => downloadUrl(`/reports/day-pdf?date=${date}&regenerate=1`, `Asscher-AI-Day-Report-${date}.pdf`)}>↻ Regenerate PDF</Button>
      </div>
      {d.holiday && <Badge color="bg-amber-100 text-amber-800">🎉 Holiday: {d.holiday.name}</Badge>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {d.branches.map((b: any) => (
          <Card key={b.label}>
            <div className="font-semibold text-sm text-slate-800 mb-1">{b.label}</div>
            <div className="text-xs text-slate-500">Due {b.counts.due} · <span className="text-emerald-700">Done {b.counts.done}</span> · <span className="text-amber-700">Pending {b.counts.pending}</span> · <span className={b.counts.late ? 'text-rose-600 font-bold' : ''}>Late {b.counts.late}</span></div>
          </Card>
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title={`Assigned that day (${d.assignedToday.length})`}>
          {d.assignedToday.length === 0 ? <Empty text="No tasks assigned" /> : d.assignedToday.map((t: any) => (
            <Link key={t.id} to={`/tasks/${t.id}`} className="block py-1.5 text-sm">
              <PriorityBadge p={t.priority} /> {t.title} <span className="text-xs text-slate-400">→ {t.assignees.map((a: any) => a.name).join(', ')}</span>
            </Link>
          ))}
        </Card>
        <Card title={`Due that day (${d.dueToday.length})`}>
          {d.dueToday.length === 0 ? <Empty text="Nothing was due" /> : d.dueToday.map((t: any) => (
            <Link key={t.id} to={`/tasks/${t.id}`} className="block py-1.5 text-sm">
              {t.title} — {t.assignees.map((a: any) => `${a.name}: `).join('')}{t.assignees.map((a: any) => a.status).join(', ')}
            </Link>
          ))}
        </Card>
        <Card title={`Submissions (${d.submissions.length})`}>
          {d.submissions.length === 0 ? <Empty text="No submissions" /> : d.submissions.map((s: any) => (
            <div key={s.id} className="py-1.5 text-sm"><b>{s.user.name}</b> → <Link className="text-brand-700" to={`/tasks/${s.task.id}`}>{s.task.title}</Link> <span className="text-xs text-slate-400">{fmtTime(s.submittedAt)}{s.files.length ? ` · ${s.files.length} file(s)` : ''}</span></div>
          ))}
        </Card>
        <Card title={`Open 🔴 alerts (${d.openAlerts.length}) · On leave (${d.leaves.length})`}>
          {d.openAlerts.map((q: any) => <Link key={q.id} to={`/queries/${q.id}`} className="block py-1 text-sm text-rose-600 font-medium">🔴 {q.title} — {q.raisedByName} → {q.holderName}</Link>)}
          {d.leaves.map((l: any, i: number) => <div key={i} className="py-1 text-sm text-slate-600">🌴 {l.user.name} ({l.type})</div>)}
          {!d.openAlerts.length && !d.leaves.length && <Empty icon="🙌" text="No alerts, everyone present" />}
        </Card>
      </div>
      <Card title={`Daily report summaries (${d.reports.length})`}>
        {d.reports.length === 0 ? <Empty text="No reports submitted" /> : (
          <div className="divide-y divide-slate-100">
            {d.reports.map((r: any) => (
              <div key={r.id} className="py-2.5">
                <div className="flex items-center gap-2 text-sm"><b>{r.user.name}</b> <StatusBadge status={r.status} /> {r.late && <Badge color="bg-rose-600 text-white">LATE</Badge>}</div>
                {r.summary && <p className="text-sm text-slate-600 mt-1">{r.summary}</p>}
                {r.attachments?.length > 0 && <div className="flex flex-wrap gap-1.5 mt-1">{r.attachments.map((a: any) => <button key={a.id} onClick={() => openFile(a.fileId)} className="text-xs bg-slate-100 rounded px-2 py-0.5">📄 {a.name}</button>)}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Archive() {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { api('/reports/archive').then((d) => setItems(d.items)); }, []);
  if (!items) return <PageLoader />;
  return (
    <Card title="Day Report Archive — every generated PDF, re-downloadable forever">
      {items.length === 0 ? <Empty icon="🗄️" text="No PDFs generated yet — open Company day view and download one" /> : (
        <ul className="divide-y divide-slate-100">
          {items.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2.5">
              <span className="text-sm font-medium text-slate-700">📕 {fmtDate(a.dateKey)}</span>
              <span className="text-xs text-slate-400">generated {fmt(a.generatedAt)}</span>
              <Button size="sm" variant="secondary" onClick={() => downloadUrl(`/reports/day-pdf?date=${a.dateKey}`, `Asscher-AI-Day-Report-${a.dateKey}.pdf`)}>⬇ PDF</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
