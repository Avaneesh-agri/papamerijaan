import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Card, PageLoader, Empty, Badge, StatusBadge, PriorityBadge, Avatar } from '../components/ui';
import { fmt } from '../lib/format';

export default function SearchPage() {
  const [sp] = useSearchParams();
  const q = sp.get('q') || '';
  const [d, setD] = useState<any>(null);
  useEffect(() => { setD(null); if (q) api(`/search?q=${encodeURIComponent(q)}`).then(setD); }, [q]);
  if (!q) return <Card><Empty icon="🔎" text="Type in the search bar above" /></Card>;
  if (!d) return <PageLoader />;
  const none = !d.tasks.length && !d.people.length && !d.queries.length && !d.videos.length && !d.vault.length;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">Results for “{q}”</h1>
      {none && <Card><Empty icon="🤷" text="Nothing found within your permissions" /></Card>}
      {d.tasks.length > 0 && (
        <Card title="Tasks">
          {d.tasks.map((t: any) => (
            <Link key={t.id} to={`/tasks/${t.id}`} className="flex items-center gap-2 py-2 text-sm hover:bg-slate-50 -mx-2 px-2 rounded-lg">
              <PriorityBadge p={t.priority} /><span className="flex-1">{t.title}</span><span className="text-xs text-slate-400">{t.dueAt && `due ${fmt(t.dueAt)}`}</span>
            </Link>
          ))}
        </Card>
      )}
      {d.people.length > 0 && (
        <Card title="People">
          {d.people.map((p: any) => (
            <Link key={p.id} to={`/people/${p.id}`} className="flex items-center gap-2.5 py-2 text-sm hover:bg-slate-50 -mx-2 px-2 rounded-lg">
              <Avatar name={p.name} size={7} /><span className="flex-1">{p.name} <span className="text-xs text-slate-400">@{p.username}</span></span>
              {p.status === 'EXITED' && <Badge color="bg-slate-200 text-slate-500">Exited</Badge>}
            </Link>
          ))}
        </Card>
      )}
      {d.queries.length > 0 && (
        <Card title="Queries">
          {d.queries.map((x: any) => (
            <Link key={x.id} to={`/queries/${x.id}`} className="flex items-center gap-2 py-2 text-sm hover:bg-slate-50 -mx-2 px-2 rounded-lg">
              {x.level === 'ALERT' && <Badge color="bg-rose-600 text-white">🔴</Badge>}<span className="flex-1">{x.title}</span><StatusBadge status={x.status} />
            </Link>
          ))}
        </Card>
      )}
      {d.videos.length > 0 && (
        <Card title="Training videos">
          {d.videos.map((v: any) => (
            <Link key={v.id} to={`/videos/${v.id}`} className="block py-2 text-sm hover:bg-slate-50 -mx-2 px-2 rounded-lg">🎬 {v.title} <span className="text-xs text-slate-400">· {v.category}</span></Link>
          ))}
        </Card>
      )}
      {d.vault.length > 0 && (
        <Card title="Vault">
          {d.vault.map((v: any) => <Link key={v.id} to="/vault" className="block py-2 text-sm hover:bg-slate-50 -mx-2 px-2 rounded-lg">🔐 {v.name}</Link>)}
        </Card>
      )}
    </div>
  );
}
