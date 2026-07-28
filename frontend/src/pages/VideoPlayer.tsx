import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, API_BASE } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, PageLoader, Empty, ErrorNote } from '../components/ui';
import { fmt } from '../lib/format';

export default function VideoPlayer() {
  const { id } = useParams();
  const { user, isHead } = useAuth();
  const [embed, setEmbed] = useState<any>(null);
  const [viewers, setViewers] = useState<any[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setEmbed(null);
    // Requesting playback creates the view log + notifies the manager & Primary Admin
    api(`/videos/${id}/play`, { method: 'POST', body: {} }).then(setEmbed).catch((e) => setErr(e.message));
    if (user.isPrimaryAdmin || isHead) api(`/videos/${id}/viewers`).then((d) => setViewers(d.views)).catch(() => {});
  }, [id]);

  if (err) return <Card><div className="text-center py-8">⚠️ {err}</div></Card>;
  if (!embed) return <PageLoader />;

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-xl font-bold text-slate-800">🎬 {embed.title}</h1>
      <div className="rounded-xl overflow-hidden bg-black aspect-video shadow-lg" onContextMenu={(e) => e.preventDefault()}>
        {/* The iframe points at OUR backend — the Drive URL never reaches this app's code */}
        <iframe src={`${API_BASE}${embed.embedPath}`} className="w-full h-full border-0" allow="autoplay; fullscreen" allowFullScreen title={embed.title} />
      </div>
      <p className="text-[11px] text-slate-400">
        Playback is watermarked with your name and logged. Downloading is disabled. (Note: no system can fully prevent screen recording — treat training material as confidential.)
      </p>
      {viewers && (
        <Card title="Viewer report (your team)">
          {viewers.length === 0 ? <Empty icon="👀" text="No views yet" /> : (
            <ul className="divide-y divide-slate-100">
              {viewers.map((v) => (
                <li key={v.id} className="py-2 flex justify-between text-sm">
                  <span><b>{v.user.name}</b> <span className="text-slate-400">@{v.user.username}</span></span>
                  <span className="text-xs text-slate-400">{fmt(v.openedAt)}{v.durationSec ? ` · watched ~${Math.max(1, Math.round(v.durationSec / 60))} min` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
