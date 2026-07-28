import React, { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Button, Input, ErrorNote } from '../components/ui';
import { api } from '../lib/api';

export default function Login() {
  const { login, revokedMsg } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [mustChange, setMustChange] = useState(false);
  const [newPw, setNewPw] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const data = await login(identifier, password);
      if (data.mustChangePassword) setMustChange(true);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api('/auth/change-password', { body: { currentPassword: password, newPassword: newPw } });
      setMustChange(false);
      window.location.reload();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-brand-600 flex items-center justify-center text-white font-black text-2xl mx-auto mb-3">A</div>
          <h1 className="text-white text-2xl font-bold">Asscher AI</h1>
          <p className="text-slate-400 text-sm mt-1">Operations Platform</p>
        </div>
        <div className="bg-white rounded-2xl shadow-xl p-6">
          {revokedMsg && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2.5 mb-4 font-medium">⚠️ {revokedMsg}</div>}
          <ErrorNote error={err} />
          {!mustChange ? (
            <form onSubmit={submit} className="space-y-4">
              <Input label="Username or email" value={identifier} onChange={(e: any) => setIdentifier(e.target.value)} autoFocus autoCapitalize="none" />
              <Input label="Password" type="password" value={password} onChange={(e: any) => setPassword(e.target.value)} />
              <Button type="submit" className="w-full" disabled={busy || !identifier || !password}>{busy ? 'Signing in…' : 'Sign in'}</Button>
              <p className="text-[11px] text-slate-400 text-center">Accounts are created by your administrator.<br />Forgot your password? Ask the Primary Admin to reset it.</p>
            </form>
          ) : (
            <form onSubmit={changePw} className="space-y-4">
              <p className="text-sm text-slate-600">Set a new password to continue.</p>
              <Input label="New password (min 8 characters)" type="password" value={newPw} onChange={(e: any) => setNewPw(e.target.value)} autoFocus />
              <Button type="submit" className="w-full" disabled={busy || newPw.length < 8}>Save & continue</Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
