import React, { useEffect, useState } from 'react';
import { api, downloadUrl } from '../lib/api';
import { Card, Button, PageLoader, Empty, Badge } from '../components/ui';
import { fmt } from '../lib/format';

export default function Activity() {
  const [d, setD] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    setD(null);
    const p = new URLSearchParams({ page: String(page) });
    if (type) p.set('type', type);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    api(`/activity?${p}`).then(setD);
  }, [page, type, from, to]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">Activity & audit log</h1>
        <Button size="sm" variant="secondary" onClick={() => downloadUrl('/activity/export.csv', 'asscher-activity-log.csv')}>⬇ Export CSV</Button>
      </div>
      <Card>
        <div className="flex flex-wrap gap-2 mb-3">
          <input value={type} onChange={(e) => { setPage(1); setType(e.target.value); }} placeholder="Filter type (LOGIN, TASK, VAULT…)" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <input type="date" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <input type="date" value={to} onChange={(e) => { setPage(1); setTo(e.target.value); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        {!d ? <PageLoader /> : d.logs.length === 0 ? <Empty icon="🕒" text="No activity matches" /> : (
          <>
            <ul className="divide-y divide-slate-50">
              {d.logs.map((l: any) => (
                <li key={l.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                  <Badge color={l.type.includes('VAULT') ? 'bg-amber-100 text-amber-800' : l.type.includes('SESSION') || l.type.includes('LOGIN') ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-600'}>{l.type}</Badge>
                  <span className="flex-1 text-slate-700 min-w-[200px]"><b>{d.users[l.actorId] || 'System'}</b> — {l.detail}</span>
                  {l.ip && <span className="text-[10px] text-slate-400">{l.ip}</span>}
                  <span className="text-xs text-slate-400">{fmt(l.createdAt)}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between mt-3 text-sm">
              <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>← Prev</Button>
              <span className="text-xs text-slate-400">Page {page} · {d.total} entries (append-only, kept forever)</span>
              <Button size="sm" variant="secondary" disabled={page * 50 >= d.total} onClick={() => setPage(page + 1)}>Next →</Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
