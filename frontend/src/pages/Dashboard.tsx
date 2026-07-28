import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Badge, StatusBadge, PriorityBadge, PageLoader, Empty, Avatar, Button } from '../components/ui';
import { fmt, fmtTime, fmtDate, inr, ago } from '../lib/format';

export default function Dashboard() {
  const { user } = useAuth();
  const [d, setD] = useState<any>(null);
  const nav = useNavigate();
  useEffect(() => { api('/dashboard').then(setD).catch(() => {}); }, []);
  if (!d) return <PageLoader />;

  const hello = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{hello}, {user.name.split(' ')[0]} 👋</h1>
          <p className="text-sm text-slate-500">{fmtDate(d.today)} · Reports due by {d.eodTime} IST{d.holiday ? ` · 🎉 Holiday: ${d.holiday.name}` : ''}{d.onLeave ? ' · You are on approved leave today' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/reports"><Button size="sm" variant={d.myReportStatus === 'NOT_FILED' ? 'primary' : 'secondary'}>{d.myReportStatus === 'NOT_FILED' ? '📝 File daily report' : `Report: ${d.myReportStatus.toLowerCase()}`}</Button></Link>
          <Link to="/tasks/new"><Button size="sm" variant="secondary">＋ New task</Button></Link>
        </div>
      </div>

      {/* Admin: persistent red stipend banner */}
      {d.admin?.stipendsOverdue?.length > 0 && (
        <Link to="/stipends" className="block rounded-xl bg-rose-600 text-white px-4 py-3 shadow animate-none">
          <b>🔴 {d.admin.stipendsOverdue.length} stipend{d.admin.stipendsOverdue.length > 1 ? 's' : ''} overdue:</b>{' '}
          {d.admin.stipendsOverdue.slice(0, 3).map((s: any) => `${inr(s.amount)} for ${s.name} (due ${fmtDate(s.dueDate)})`).join(' · ')}
          {d.admin.stipendsOverdue.length > 3 ? ' · …' : ''} — tap to resolve
        </Link>
      )}

      {/* Stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Tasks due today" value={d.myTasks.length} onClick={() => nav('/tasks')} />
        <Stat label="Open tasks" value={d.myOpenTasks} onClick={() => nav('/tasks')} />
        <Stat label="Current streak" value={`${d.streak.current} 🔥`} sub={`Best ${d.streak.best}`} onClick={() => nav('/streaks')} />
        <Stat label="My open queries" value={d.myQueries.length} onClick={() => nav('/queries')} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* My tasks today */}
        <Card title="My tasks due today" action={<Link to="/tasks" className="text-xs text-brand-700 font-medium">All tasks →</Link>}>
          {d.myTasks.length === 0 ? <Empty icon="✨" text={d.onLeave ? 'On leave — nothing due' : 'Nothing due today'} /> : (
            <ul className="divide-y divide-slate-100">
              {d.myTasks.map((t: any) => (
                <li key={t.taskId}>
                  <Link to={`/tasks/${t.taskId}`} className="flex items-center gap-2 py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded-lg">
                    <PriorityBadge p={t.priority} />
                    <span className="flex-1 text-sm text-slate-700 truncate">{t.title}</span>
                    <span className="text-xs text-slate-400">{fmtTime(t.dueAt)}</span>
                    <StatusBadge status={t.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* My queries */}
        <Card title="My open queries" action={<Link to="/queries" className="text-xs text-brand-700 font-medium">All queries →</Link>}>
          {d.myQueries.length === 0 ? <Empty icon="🙌" text="No open queries" /> : (
            <ul className="divide-y divide-slate-100">
              {d.myQueries.map((q: any) => (
                <li key={q.id}>
                  <Link to={`/queries/${q.id}`} className="flex items-center gap-2 py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded-lg">
                    {q.level === 'ALERT' && <Badge color="bg-rose-600 text-white">🔴</Badge>}
                    <span className="flex-1 text-sm truncate">{q.title}</span>
                    <StatusBadge status={q.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* HEAD: live team board */}
      {d.team && (
        <Card title="Team board — today" action={<div className="flex gap-3"><Link to="/queries?raise=req" className="text-xs text-brand-700 font-medium">Raise requirement</Link><Link to="/reports?tab=team" className="text-xs text-brand-700 font-medium">Review reports ({d.team.reportsToReview}) →</Link></div>}>
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm min-w-[560px]">
              <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="py-2 font-medium">Person</th><th className="font-medium">Today's tasks</th><th className="font-medium">Report</th><th className="font-medium">Streak</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {d.team.board.map((row: any) => (
                  <tr key={row.user.id} className={row.onLeave ? 'opacity-60' : ''}>
                    <td className="py-2.5 pr-3">
                      <Link to={`/people/${row.user.id}`} className="flex items-center gap-2">
                        <Avatar name={row.user.name} size={7} />
                        <span className="font-medium text-slate-700">{row.user.name}</span>
                        {row.onLeave && <Badge color="bg-amber-100 text-amber-700">On leave</Badge>}
                      </Link>
                    </td>
                    <td className="pr-3">
                      {row.tasks.length === 0 ? <span className="text-xs text-slate-400">—</span> : (
                        <div className="flex flex-wrap gap-1.5">
                          {row.tasks.map((t: any) => (
                            <Link key={t.taskId} to={`/tasks/${t.taskId}`} title={`${t.title}${t.firstOpenedAt ? ` · opened ${fmtTime(t.firstOpenedAt)}` : ' · not opened yet'}`}>
                              <Badge color={t.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : t.status === 'SUBMITTED' ? 'bg-violet-100 text-violet-800' : t.firstOpenedAt ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-500'}>
                                {t.title.slice(0, 18)}{t.title.length > 18 ? '…' : ''}{t.firstOpenedAt ? ` 👁 ${fmtTime(t.firstOpenedAt)}` : ' · unopened'}
                              </Badge>
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="pr-3"><StatusBadge status={row.report} />{row.reportLate && <Badge color="bg-rose-100 text-rose-700" className="ml-1">LATE</Badge>}</td>
                    <td className="text-sm">{row.streak} 🔥</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(d.team.queries.length > 0 || d.team.pendingLeaves.length > 0) && (
            <div className="grid sm:grid-cols-2 gap-3 mt-4 pt-3 border-t border-slate-100">
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-1.5">Queries with me</div>
                {d.team.queries.slice(0, 4).map((q: any) => (
                  <Link key={q.id} to={`/queries/${q.id}`} className={`block text-sm py-1 ${q.level === 'ALERT' ? 'text-rose-600 font-semibold' : 'text-slate-600'}`}>
                    {q.level === 'ALERT' ? '🔴 ' : '• '}{q.title} <span className="text-xs text-slate-400">from {q.raisedByName}</span>
                  </Link>
                ))}
                {!d.team.queries.length && <div className="text-xs text-slate-400">None</div>}
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-1.5">Leave approvals pending</div>
                {d.team.pendingLeaves.slice(0, 4).map((l: any) => (
                  <Link key={l.id} to="/leaves?tab=approvals" className="block text-sm py-1 text-slate-600">• {l.user.name}: {fmtDate(l.startDate)} → {fmtDate(l.endDate)}</Link>
                ))}
                {!d.team.pendingLeaves.length && <div className="text-xs text-slate-400">None</div>}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* PRIMARY ADMIN: company pulse */}
      {d.admin && (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Open 🔴 alerts" value={d.admin.openAlerts} danger={d.admin.openAlerts > 0} onClick={() => nav('/queries')} />
            <Stat label="Reports awaiting review" value={d.admin.reportsAwaiting} onClick={() => nav('/reports?tab=team')} />
            <Stat label="On leave today" value={d.admin.onLeaveToday.length} sub={d.admin.onLeaveToday.map((x: any) => x.name).slice(0, 2).join(', ')} onClick={() => nav('/leaves?tab=calendar')} />
            <Stat label="Requirements inbox" value={d.admin.requirements.length} onClick={() => nav('/queries?tab=requirements')} />
          </div>
          <Card title="Today by department / branch" action={<Link to="/reports?tab=day" className="text-xs text-brand-700 font-medium">Full day view →</Link>}>
            {d.admin.byDept.length === 0 ? <Empty text="No branches yet — add people under you in People" /> : (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-sm min-w-[480px]">
                  <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                    <th className="py-2 font-medium">Branch</th><th className="font-medium">Due</th><th className="font-medium">Done</th><th className="font-medium">Pending</th><th className="font-medium">Late</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {d.admin.byDept.map((b: any) => (
                      <tr key={b.rootId} className="hover:bg-slate-50 cursor-pointer" onClick={() => nav('/reports?tab=day')}>
                        <td className="py-2.5 font-medium text-slate-700">{b.label}</td>
                        <td>{b.assigned}</td>
                        <td className="text-emerald-700">{b.done}</td>
                        <td className="text-amber-700">{b.pending}</td>
                        <td className={b.late ? 'text-rose-600 font-bold' : ''}>{b.late}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <div className="grid lg:grid-cols-3 gap-4">
            <Card title="Requirements inbox" action={<Link to="/queries?tab=requirements" className="text-xs text-brand-700 font-medium">Open →</Link>}>
              {d.admin.requirements.length === 0 ? <Empty icon="📥" text="Empty inbox" /> :
                d.admin.requirements.slice(0, 5).map((r: any) => (
                  <Link key={r.id} to="/queries?tab=requirements" className="block py-1.5 text-sm text-slate-700">• {r.title} <span className="text-xs text-slate-400">— {r.raisedByName}</span></Link>
                ))}
            </Card>
            <Card title="Streak milestones 🔥">
              {d.admin.milestones.length === 0 ? <Empty icon="🔥" text="No milestones yet" /> :
                d.admin.milestones.map((m: any) => (
                  <div key={m.id} className="py-1.5 text-sm text-slate-700">🔥 <b>{m.name}</b> hit a {m.days}-day streak <span className="text-xs text-slate-400">{fmtDate(m.dateKey)}</span></div>
                ))}
            </Card>
            <Card title="Renewals due (7 days)">
              {d.admin.renewals.length === 0 ? <Empty icon="💳" text="Nothing due soon" /> :
                d.admin.renewals.map((r: any) => (
                  <Link key={r.id} to="/vault" className="block py-1.5 text-sm text-slate-700">💳 {r.name} — <b>{fmtDate(r.renewalDate)}</b></Link>
                ))}
            </Card>
          </div>
          <Card title="Recent activity" action={<Link to="/activity" className="text-xs text-brand-700 font-medium">Full log →</Link>}>
            <ul className="divide-y divide-slate-50">
              {d.admin.activity.map((a: any) => (
                <li key={a.id} className="py-1.5 text-sm text-slate-600 flex justify-between gap-3">
                  <span className="truncate"><b className="text-slate-700">{a.actorName || 'System'}</b> — {a.detail}</span>
                  <span className="text-xs text-slate-400 shrink-0">{ago(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, onClick, danger }: any) {
  return (
    <button onClick={onClick} className={`text-left rounded-xl border p-3.5 shadow-sm transition hover:shadow ${danger ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200'}`}>
      <div className={`text-2xl font-bold ${danger ? 'text-rose-600' : 'text-slate-800'}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-slate-400 truncate">{sub}</div>}
    </button>
  );
}
