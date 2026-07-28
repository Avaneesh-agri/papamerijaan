import React, { useEffect, useRef, useState } from 'react';
import { uploadFile } from '../lib/api';
import { STATUS_COLOR, STATUS_LABEL } from '../lib/format';

export function Button({ children, variant = 'primary', size = 'md', className = '', ...props }: any) {
  const variants: any = {
    primary: 'bg-brand-700 hover:bg-brand-800 text-white shadow-sm',
    secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white',
    ghost: 'text-slate-600 hover:bg-slate-100',
  };
  const sizes: any = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-base' };
  return (
    <button className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Card({ children, className = '', title, action }: any) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-4 pt-3.5 pb-0">
          <h3 className="font-semibold text-slate-800 text-sm">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, any>(({ label, className = '', ...props }, ref) => (
  <label className="block">
    {label && <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>}
    <input ref={ref} className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 bg-white ${className}`} {...props} />
  </label>
));

export function Textarea({ label, className = '', ...props }: any) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>}
      <textarea className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 min-h-[80px] ${className}`} {...props} />
    </label>
  );
}

export function Select({ label, children, className = '', ...props }: any) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>}
      <select className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 ${className}`} {...props}>
        {children}
      </select>
    </label>
  );
}

export function Badge({ children, color = 'bg-slate-100 text-slate-700', className = '' }: any) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${color} ${className}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge color={STATUS_COLOR[status] || 'bg-slate-100 text-slate-700'}>{STATUS_LABEL[status] || status}</Badge>;
}

export function PriorityBadge({ p }: { p: string }) {
  if (p === 'ALERT') return <Badge color="bg-rose-600 text-white" className="animate-pulse">🔴 ALERT</Badge>;
  if (p === 'HIGH') return <Badge color="bg-amber-100 text-amber-800">High</Badge>;
  return <Badge color="bg-slate-100 text-slate-600">Normal</Badge>;
}

export function Avatar({ name, size = 8 }: { name?: string; size?: number }) {
  const initials = (name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  const colors = ['bg-brand-600', 'bg-indigo-500', 'bg-rose-500', 'bg-amber-500', 'bg-emerald-600', 'bg-sky-600'];
  const c = colors[(name || '').length % colors.length];
  return <div className={`w-${size} h-${size} shrink-0 rounded-full ${c} text-white flex items-center justify-center text-xs font-bold`} style={{ width: size * 4, height: size * 4 }}>{initials}</div>;
}

export function Modal({ open, onClose, title, children, wide }: any) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className={`bg-white w-full sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[92vh] overflow-y-auto ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ className = '' }: any) {
  return <div className={`animate-spin rounded-full border-2 border-slate-300 border-t-brand-600 w-5 h-5 ${className}`} />;
}

export function PageLoader() {
  return <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>;
}

export function Empty({ icon = '🗂️', text = 'Nothing here yet' }: any) {
  return (
    <div className="text-center py-10 text-slate-400">
      <div className="text-3xl mb-2">{icon}</div>
      <div className="text-sm">{text}</div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: React.ReactNode }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="flex gap-1 border-b border-slate-200 mb-4 overflow-x-auto no-scrollbar">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`px-3.5 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition ${active === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorNote({ error }: { error?: string | null }) {
  if (!error) return null;
  return <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2 mb-3">{error}</div>;
}

/** Multi-file upload zone: uploads immediately, reports [{id,name,size}]. */
export function FileUpload({ files, onChange, scope = 'GENERAL', label = 'Attach files' }: any) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true); setErr('');
    try {
      const out = [...files];
      for (const f of Array.from(list)) {
        if (f.size > 10 * 1024 * 1024) { setErr(`${f.name} is over 10 MB`); continue; }
        out.push(await uploadFile(f, scope));
      }
      onChange(out);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <div>
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      <div className="rounded-lg border-2 border-dashed border-slate-300 p-3 text-center hover:border-brand-400 transition cursor-pointer" onClick={() => ref.current?.click()}>
        <input ref={ref} type="file" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
        {busy ? <Spinner className="mx-auto" /> : <span className="text-xs text-slate-500">📎 Tap to upload (multiple allowed · 10 MB each)</span>}
      </div>
      {err && <div className="text-xs text-rose-600 mt-1">{err}</div>}
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f: any, i: number) => (
            <li key={f.id} className="flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1.5">
              <span className="truncate">📄 {f.name}</span>
              <button className="text-rose-500 ml-2" onClick={() => onChange(files.filter((_: any, j: number) => j !== i))}>remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Simple searchable multi/single user picker. */
export function UserPicker({ users, value, onChange, multi = true, label = 'Assign to' }: any) {
  const [q, setQ] = useState('');
  const sel = new Set(value);
  const filtered = users.filter((u: any) => (u.name + u.username).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-1.5" />
      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
        {filtered.map((u: any) => (
          <button type="button" key={u.id}
            onClick={() => {
              if (multi) { const next = new Set(sel); next.has(u.id) ? next.delete(u.id) : next.add(u.id); onChange([...next]); }
              else onChange([u.id]);
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${sel.has(u.id) ? 'bg-brand-50' : ''}`}>
            <Avatar name={u.name} size={6} />
            <span className="flex-1 truncate">{u.name} <span className="text-slate-400 text-xs">@{u.username}</span></span>
            {sel.has(u.id) && <span className="text-brand-600 font-bold">✓</span>}
          </button>
        ))}
        {!filtered.length && <div className="text-xs text-slate-400 p-3">No people found</div>}
      </div>
    </div>
  );
}
