import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Card, Button, Badge, PageLoader, Empty, Modal, Input, Textarea, ErrorNote, UserPicker } from '../components/ui';
import { fmtDate, fmt, inr, monthKey } from '../lib/format';

export default function Stipends() {
  const [d, setD] = useState<any>(null);
  const [period, setPeriod] = useState('');
  const [pay, setPay] = useState<any>(null);
  const [note, setNote] = useState('');
  const [bonus, setBonus] = useState(false);
  const [bonusForm, setBonusForm] = useState<any>({ userIds: [], amount: '', note: '' });
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState('');

  const load = () => api(`/hr/stipends${period ? `?period=${period}` : ''}`).then(setD).catch((e) => setErr(e.message));
  useEffect(load, [period]);
  useEffect(() => { api('/users').then((x) => setUsers(x.users.filter((u: any) => u.status === 'ACTIVE'))); }, []);

  if (err && !d) return <Card><div className="text-center py-6">🔒 {err}</div></Card>;
  if (!d) return <PageLoader />;

  async function markPaid() {
    await api(`/hr/stipends/${pay.id}/pay`, { body: { note } });
    setPay(null); setNote(''); load();
  }
  async function addBonus() {
    setErr('');
    try {
      for (const uid of bonusForm.userIds) await api('/hr/stipends/bonus', { body: { userId: uid, amount: Number(bonusForm.amount), note: bonusForm.note } });
      setBonus(false); setBonusForm({ userIds: [], amount: '', note: '' }); load();
    } catch (e: any) { setErr(e.message); }
  }

  const overdue = d.records.filter((r: any) => r.overdue);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">Stipend tracker</h1>
        <div className="flex gap-2">
          <input type="month" value={period || monthKey()} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white" />
          <Button size="sm" variant="secondary" onClick={() => setBonus(true)}>🎁 Add bonus</Button>
        </div>
      </div>

      {overdue.length > 0 && (
        <div className="rounded-xl bg-rose-600 text-white px-4 py-3">
          <b>🔴 {overdue.length} overdue:</b> {overdue.map((o: any) => `${inr(o.amount)} for ${o.user.name} (due ${fmtDate(o.dueDate)})`).join(' · ')}
          <div className="text-xs text-rose-100 mt-0.5">This banner stays until each one is marked paid. The system only records and reminds — it never pays automatically.</div>
        </div>
      )}

      <Card>
        {d.records.length === 0 ? <Empty icon="₹" text="No stipend records — set stipend amounts on people's profiles" /> : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm min-w-[560px]">
              <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="py-2 font-medium">Person</th><th className="font-medium">Period</th><th className="font-medium">Type</th><th className="font-medium">Amount</th><th className="font-medium">Due</th><th className="font-medium">Status</th><th></th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {d.records.map((r: any) => (
                  <tr key={r.id} className={r.overdue ? 'bg-rose-50' : ''}>
                    <td className="py-2.5"><Link to={`/people/${r.user.id}`} className="font-medium text-slate-700">{r.user.name}</Link>{r.user.status === 'EXITED' && <Badge color="bg-slate-200 text-slate-500" className="ml-1">Exited</Badge>}</td>
                    <td>{r.periodKey}</td>
                    <td>{r.kind === 'BONUS' ? <Badge color="bg-amber-100 text-amber-700">Bonus</Badge> : 'Stipend'}</td>
                    <td className="font-semibold">{inr(r.amount)}</td>
                    <td className={r.overdue ? 'text-rose-600 font-bold' : ''}>{fmtDate(r.dueDate)}</td>
                    <td>
                      {r.paidAt ? <Badge color="bg-emerald-100 text-emerald-700">Paid {fmtDate(r.paidAt)}</Badge>
                        : r.overdue ? <Badge color="bg-rose-600 text-white">OVERDUE</Badge>
                        : <Badge color="bg-amber-100 text-amber-700">Due</Badge>}
                      {r.paidNote && <div className="text-[10px] text-slate-400">{r.paidNote}</div>}
                    </td>
                    <td className="text-right">{!r.paidAt && <Button size="sm" onClick={() => setPay(r)}>Mark paid</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!pay} onClose={() => setPay(null)} title={`Mark paid — ${inr(pay?.amount)} to ${pay?.user?.name}`}>
        <Textarea label="Payment reference / note" value={note} onChange={(e: any) => setNote(e.target.value)} placeholder="e.g. UPI ref 4021…, paid on 5 Aug" />
        <Button className="mt-3" onClick={markPaid}>✓ Mark paid</Button>
      </Modal>

      <Modal open={bonus} onClose={() => setBonus(false)} title="Add manual bonus (e.g. streak bonus)">
        <ErrorNote error={err} />
        <div className="space-y-3">
          <UserPicker users={users} value={bonusForm.userIds} onChange={(x: any) => setBonusForm({ ...bonusForm, userIds: x })} label="Who earned it?" />
          <Input label="Amount (₹)" type="number" value={bonusForm.amount} onChange={(e: any) => setBonusForm({ ...bonusForm, amount: e.target.value })} />
          <Input label="Note" value={bonusForm.note} onChange={(e: any) => setBonusForm({ ...bonusForm, note: e.target.value })} placeholder="e.g. 30-day streak bonus 🔥" />
          <Button onClick={addBonus} disabled={!bonusForm.userIds.length || !bonusForm.amount}>Record bonus</Button>
        </div>
      </Modal>
    </div>
  );
}
