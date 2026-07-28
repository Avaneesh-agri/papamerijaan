import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, getToken, setSessionRevokedHandler } from './api';

interface AuthState {
  user: any; isHead: boolean; settings: any; loading: boolean; revokedMsg: string;
  login: (identifier: string, password: string) => Promise<any>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [isHead, setIsHead] = useState(false);
  const [settings, setSettings] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [revokedMsg, setRevokedMsg] = useState('');

  useEffect(() => {
    setSessionRevokedHandler((msg) => {
      setToken(null); setUser(null); setRevokedMsg(msg);
    });
    refresh();
  }, []);

  async function refresh() {
    if (!getToken()) { setLoading(false); return; }
    try {
      const data = await api('/auth/me');
      setUser(data.user); setIsHead(data.isHead); setSettings(data.settings || {});
    } catch { /* handled by revoke handler or stays logged out */ }
    setLoading(false);
  }

  async function login(identifier: string, password: string) {
    const deviceInfo = `${navigator.platform || 'Device'} · ${/Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop'} · ${(navigator.userAgent.match(/(Chrome|Safari|Firefox|Edg)\/[\d.]+/) || ['Browser'])[0]}`;
    const data = await api('/auth/login', { body: { identifier, password, deviceInfo } });
    setToken(data.token); setRevokedMsg('');
    await refresh();
    return data;
  }

  async function logout() {
    try { await api('/auth/logout', { method: 'POST', body: {} }); } catch {}
    setToken(null); setUser(null);
  }

  return <Ctx.Provider value={{ user, isHead, settings, loading, revokedMsg, login, logout, refresh }}>{children}</Ctx.Provider>;
}
