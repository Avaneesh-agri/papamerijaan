import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Tabs, Badge, StatusBadge, PriorityBadge, PageLoader, Empty, Button, Input } from '../components/ui';
import { fmt } from '../lib/format';

export default function TasksList() {
  const { user, isHead } = useAuth();
  const [tab, setTab] = useState('mine');
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [date, setDate] = useState('');
  const [q, setQ] = useState('');

  const load = async () => {
    setTasks(null);
    const params = new URLSearchParams({ scope: tab });
    if (date) params.set('date', date);
    if (q) params.set('q', q);
    const d = await api(`/tasks?${params}`);
    setTasks(d.tasks);
  };
  useEffect(() => { load(); }, [tab, date]);

  const tabs = [
    { key: 'mine', label: 'My tasks' },
    { key: 'created', label: 'Created by me' },
    ...(isHead || user.isPrimaryAdmin ? [{ key: 'team', label: 'Team' }] : []),
    ...(isHead || user.isPrimaryAdmin ? [{ key: 'templates', label: 'Recurring' }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">Tasks</h1>
        <Link to="/tasks/new"><Button size="sm">＋ New task</Button></Link>
      </div>
      <Card>
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
        <div className="flex flex-wrap gap-2 mb-3">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          {date && <Button size="sm" variant="ghost" onClick={() => setDate('')}>Clear date</Button>}
          <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex-1 min-w-[140px]">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title…" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          </form>
        </div>
        {!tasks ? <PageLoader /> : tasks.length === 0 ? <Empty text="No tasks here" /> : (
          <ul className="divide-y divide-slate-100">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link to={`/tasks/${t.id}`} className="flex flex-wrap items-center gap-2 py-3 hover:bg-slate-50 -mx-2 px-2 rounded-lg">
                  <PriorityBadge p={t.priority} />
                  <div className="flex-1 min-w-[180px]">
                    <div className="text-sm font-medium text-slate-800">{t.title}</div>
                    <div className="text-xs text-slate-400">
                      {t.isRecurringTemplate ? `↻ ${t.recurrenceRule?.freq === 'WEEKLY' ? 'Weekly' : 'Daily'} at ${t.recurrenceRule?.dueTime || '18:00'}` : t.dueAt ? `Due ${fmt(t.dueAt)}` : 'No deadline'}
                      {t.parentTaskId && ' · part of a directive'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {t.assignees.slice(0, 3).map((a: any) => (
                      <span key={a.userId} className="inline-flex items-center gap-1">
                        <Badge>{a.name?.split(' ')[0]}</Badge>
                        <StatusBadge status={a.status} />
                      </span>
                    ))}
                    {t.assignees.length > 3 && <Badge>+{t.assignees.length - 3}</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
