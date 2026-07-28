import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { Avatar, Badge } from './ui';
import { ago } from '../lib/format';

const NAV = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/tasks', label: 'Tasks', icon: '✅' },
  { to: '/reports', label: 'Reports', icon: '📋' },
  { to: '/queries', label: 'Queries', icon: '💬' },
  { to: '/people', label: 'People', icon: '👥' },
  { to: '/leaves', label: 'Leaves', icon: '🌴' },
  { to: '/streaks', label: 'Streaks', icon: '🔥' },
  { to: '/videos', label: 'Training', icon: '🎬' },
  { to: '/announcements', label: 'Announcements', icon: '📢' },
  { to: '/activity', label: 'Activity', icon: '🕒' },
];
const ADMIN_NAV = [
  { to: '/stipends', label: 'Stipends', icon: '₹' },
  { to: '/vault', label: 'Vault', icon: '🔐' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, isHead, logout } = useAuth();
  const nav = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [unread, setUnread] = useState({ count: 0, alerts: 0 });
  const [notifs, setNotifs] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const bellRef = useRef<HTMLDivElement>(null);

  const vaultVisible = user?.isPrimaryAdmin || isHead;
  const items = [...NAV, ...(user?.isPrimaryAdmin ? ADMIN_NAV : vaultVisible ? [{ to: '/vault', label: 'Vault', icon: '🔐' }] : [])];

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try { const d = await api('/notifications/unread-count'); if (alive) setUnread(d); } catch {}
    };
    poll();
    const t = setInterval(poll, 25000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (bellRef.current && !bellRef.current.contains(e.target as any)) setBellOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  async function openBell() {
    setBellOpen(!bellOpen);
    if (!bellOpen) {
      const d = await api('/notifications');
      setNotifs(d.notifications);
      api('/notifications/read', { body: {} }).then(() => setUnread({ count: 0, alerts: 0 })).catch(() => {});
    }
  }

  const search = (e: React.FormEvent) => { e.preventDefault(); if (q.trim()) { nav(`/search?q=${encodeURIComponent(q.trim())}`); setQ(''); } };

  const SidebarLinks = ({ onPick }: { onPick?: () => void }) => (
    <nav className="space-y-0.5">
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={onPick}
          className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${isActive ? 'bg-brand-700 text-white' : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'}`}>
          <span className="w-5 text-center">{n.icon}</span> {n.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 bg-slate-900 flex-col p-4 z-30">
        <Link to="/" className="flex items-center gap-2.5 px-2 mb-6">
          <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center text-white font-black text-lg">A</div>
          <div>
            <div className="text-white font-bold leading-tight">Asscher AI</div>
            <div className="text-[10px] text-slate-400 tracking-wider uppercase">Operations</div>
          </div>
        </Link>
        <div className="flex-1 overflow-y-auto no-scrollbar"><SidebarLinks /></div>
        <div className="pt-3 border-t border-slate-700/70 mt-3">
          <Link to={`/people/${user?.id}`} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-800">
            <Avatar name={user?.name} size={8} />
            <div className="min-w-0">
              <div className="text-sm text-white font-medium truncate">{user?.name}</div>
              <div className="text-[11px] text-slate-400 truncate">{user?.isPrimaryAdmin ? 'Primary Admin' : isHead ? 'Head' : 'Team member'}</div>
            </div>
          </Link>
          <button onClick={() => logout()} className="w-full text-left text-xs text-slate-400 hover:text-white px-2 py-1.5">Sign out</button>
        </div>
      </aside>

      {/* Mobile slide-over */}
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMenuOpen(false)}>
          <aside className="absolute inset-y-0 left-0 w-64 bg-slate-900 p-4 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 px-2 mb-5">
              <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center text-white font-black">A</div>
              <div className="text-white font-bold">Asscher AI</div>
            </div>
            <SidebarLinks onPick={() => setMenuOpen(false)} />
            <button onClick={() => logout()} className="mt-5 text-xs text-slate-400 px-3">Sign out</button>
          </aside>
        </div>
      )}

      {/* Top bar */}
      <header className="fixed top-0 right-0 left-0 lg:left-60 h-14 bg-white border-b border-slate-200 z-20 flex items-center gap-3 px-4">
        <button className="lg:hidden text-xl" onClick={() => setMenuOpen(true)}>☰</button>
        <form onSubmit={search} className="flex-1 max-w-md">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks, people, queries…"
            className="w-full rounded-full bg-slate-100 border border-transparent focus:border-brand-400 focus:bg-white px-4 py-1.5 text-sm outline-none transition" />
        </form>
        <div className="ml-auto flex items-center gap-2" ref={bellRef}>
          <div className="relative">
            <button onClick={openBell} className="relative w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-lg">
              🔔
              {unread.count > 0 && (
                <span className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center ${unread.alerts ? 'bg-rose-600 animate-pulse' : 'bg-brand-600'}`}>
                  {unread.count > 99 ? '99+' : unread.count}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="absolute right-0 top-11 w-80 max-h-[70vh] overflow-y-auto bg-white rounded-xl shadow-xl border border-slate-200">
                <div className="px-4 py-2.5 font-semibold text-sm border-b border-slate-100">Notifications</div>
                {notifs.length === 0 && <div className="p-4 text-sm text-slate-400">All caught up 🎉</div>}
                {notifs.map((n) => (
                  <button key={n.id} onClick={() => { setBellOpen(false); if (n.link) nav(n.link); }}
                    className={`w-full text-left px-4 py-2.5 border-b border-slate-50 hover:bg-slate-50 ${n.level === 'ALERT' ? 'bg-rose-50' : ''}`}>
                    <div className={`text-[13px] ${n.level === 'ALERT' ? 'text-rose-700 font-semibold' : 'text-slate-700'} ${!n.readAt ? 'font-semibold' : ''}`}>{n.title}</div>
                    {n.body && <div className="text-xs text-slate-500 truncate">{n.body}</div>}
                    <div className="text-[10px] text-slate-400 mt-0.5">{ago(n.createdAt)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Link to={`/people/${user?.id}`} className="lg:hidden"><Avatar name={user?.name} size={8} /></Link>
        </div>
      </header>

      {/* Content */}
      <main className="pt-14 lg:pl-60 pb-20 lg:pb-6">
        <div className="max-w-6xl mx-auto p-4 sm:p-6">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-30 grid grid-cols-5 pb-[env(safe-area-inset-bottom)]">
        {[NAV[0], NAV[1], NAV[2], NAV[3]].map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}
            className={({ isActive }) => `flex flex-col items-center py-2 text-[10px] font-medium ${isActive ? 'text-brand-700' : 'text-slate-400'}`}>
            <span className="text-lg leading-none mb-0.5">{n.icon}</span>{n.label}
          </NavLink>
        ))}
        <button onClick={() => setMenuOpen(true)} className="flex flex-col items-center py-2 text-[10px] font-medium text-slate-400">
          <span className="text-lg leading-none mb-0.5">☰</span>More
        </button>
      </nav>
    </div>
  );
}
