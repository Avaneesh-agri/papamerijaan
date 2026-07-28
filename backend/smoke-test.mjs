// Acceptance-checklist smoke tests against a running local API + seeded demo org.
const API = 'http://localhost:4000/api';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✔ ${name}`); } else { fail++; console.log(`  ✘ FAIL: ${name} ${extra}`); } };

async function req(method, path, token, body, raw = false) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (identifier, password = 'Password@123', deviceInfo = 'test-device') =>
  (await req('POST', '/auth/login', null, { identifier, password, deviceInfo })).data;

console.log('— Auth & device control —');
const admin = await login('admin', 'ChangeMe@123', 'admin-laptop');
ok('admin login', !!admin.token);
const aisha1 = await login('aisha');
ok('head login (aisha)', !!aisha1.token);
const aisha2 = await login('AISHA@asscher.ai'); // email, case-insensitive, second device
ok('login via email works', !!aisha2.token);
let r = await req('GET', '/auth/me', aisha1.token);
ok('worker second device kills first session', r.status === 401 && r.data.code === 'SESSION_REVOKED' && /another device/i.test(r.data.error), JSON.stringify(r.data));
// Primary admin: 5 concurrent sessions, 6th bumps oldest
const adminTokens = [admin.token];
for (let i = 0; i < 4; i++) adminTokens.push((await login('admin', 'ChangeMe@123', `admin-dev-${i}`)).token);
let all5 = true;
for (const t of adminTokens) all5 = all5 && (await req('GET', '/auth/me', t)).status === 200;
ok('admin holds 5 concurrent sessions', all5);
const sixth = await login('admin', 'ChangeMe@123', 'admin-dev-6');
r = await req('GET', '/auth/me', adminTokens[0]);
ok('6th admin login bumps the oldest', r.status === 401);
r = await req('GET', '/auth/me', adminTokens[4]);
ok('newer admin session still alive', r.status === 200);
const adminT = sixth.token;

console.log('— Org scoping (server-side 403 by direct URL) —');
const rohan = await login('rohan');
const users = (await req('GET', '/users', adminT)).data.users;
const uid = Object.fromEntries(users.map(u => [u.username, u.id]));
r = await req('GET', `/users/${uid.priya}`, rohan.token); // priya is in aisha's branch, not rohan's
ok('head cannot open another branch profile by URL (403)', r.status === 403);
r = await req('GET', `/users/${uid.admin}`, rohan.token);
ok('head cannot open Primary Admin profile (403)', r.status === 403);
const aisha = await login('aisha');
r = await req('GET', `/users/${uid.priya}`, aisha.token);
ok('head CAN open own subtree profile', r.status === 200);

console.log('— Task cascade, read receipts, review loop —');
// Admin posts directive to Aisha
r = await req('POST', '/tasks', adminT, { title: 'Work on LinkedIn and generate posts', description: 'Directive of the day', priority: 'HIGH', assigneeIds: [uid.aisha], submissionMethod: 'TEXT', dueAt: new Date(Date.now() + 6 * 3600e3).toISOString() });
const directiveId = r.data?.task?.id;
ok('admin creates directive', !!directiveId);
r = await req('POST', `/tasks/${directiveId}/open`, aisha.token);
r = await req('GET', `/tasks/${directiveId}`, adminT);
ok('assigner sees Opened-at read receipt', !!r.data.task.assignees.find(a => a.userId === uid.aisha)?.firstOpenedAt);
// Aisha breaks it down for Priya — original must never change
r = await req('POST', '/tasks', aisha.token, { title: '7 photos, 7 posts, 7 videos', description: 'due 6 PM — submit via Drive link — follow Protocol P-12', parentTaskId: directiveId, assigneeIds: [uid.priya], submissionMethod: 'LINK', dueAt: new Date(Date.now() + 4 * 3600e3).toISOString() });
const childId = r.data?.task?.id;
ok('head creates child task under directive', !!childId);
r = await req('PATCH', `/tasks/${directiveId}`, aisha.token, { title: 'HACKED TITLE' });
ok('head cannot edit the original directive (403)', r.status === 403);
r = await req('POST', '/tasks', aisha.token, { title: 'cross-branch grab', assigneeIds: [uid.sneha] });
ok('head cannot assign outside own subtree (403)', r.status === 403);
const priya = await login('priya');
r = await req('GET', `/tasks/${childId}`, priya.token);
ok('worker opens own task', r.status === 200);
r = await req('GET', `/tasks/${directiveId}`, priya.token);
ok('worker cannot open the directive-from-above by URL (403)', r.status === 403);
r = await req('GET', `/tasks/${childId}`, rohan.token);
ok('other branch head cannot open task by URL (403)', r.status === 403);
r = await req('POST', `/tasks/${childId}/submit`, priya.token, { linkUrl: 'https://drive.google.com/folder/xyz', content: 'All 21 assets done' });
ok('worker submits', r.status === 200);
r = await req('POST', `/tasks/${childId}/review`, aisha.token, { submissionId: null, result: 'RETURNED' });
ok('return without note rejected', r.status === 400);
const subs = (await req('GET', `/tasks/${childId}`, aisha.token)).data.task.submissions;
r = await req('POST', `/tasks/${childId}/review`, aisha.token, { submissionId: subs[0].id, result: 'RETURNED', note: 'Redo video 3' });
ok('returned for rework with note', r.status === 200);
r = await req('POST', `/tasks/${childId}/submit`, priya.token, { linkUrl: 'https://drive.google.com/folder/xyz2', content: 'Fixed' });
const subs2 = (await req('GET', `/tasks/${childId}`, aisha.token)).data.task.submissions;
r = await req('POST', `/tasks/${childId}/review`, aisha.token, { submissionId: subs2[1].id, result: 'APPROVED' });
ok('resubmission approved', r.status === 200);

console.log('— Queries, alerts, escalation —');
r = await req('POST', '/queries', priya.token, { title: 'Drive access blocked', body: 'Cannot open the shared folder', level: 'ALERT' });
const qId = r.data?.query?.id;
ok('worker raises 🔴 alert to own head', !!qId && r.data.query.assignedToId === uid.aisha);
r = await req('POST', `/queries/${qId}/action`, aisha.token, { action: 'ESCALATE', note: 'Needs admin billing access' });
ok('head escalates one level up', r.status === 200);
r = await req('GET', `/queries/${qId}`, adminT);
ok('escalation trail visible to admin', r.data.query.assignedToId === uid.admin && r.data.query.messages.some(m => m.kind === 'ESCALATE'));
r = await req('POST', `/queries/${qId}/action`, adminT, { action: 'RESOLVE' });
ok('resolve without note rejected', r.status === 400);
r = await req('POST', `/queries/${qId}/action`, adminT, { action: 'RESOLVE', note: 'Gave access via admin console' });
ok('resolved with note', r.status === 200);
r = await req('GET', '/queries/requirements/list', aisha.token);
await req('POST', '/queries/requirements', aisha.token, { title: 'Need 1 more video editor', detail: 'Workload doubled' });
const reqs = (await req('GET', '/queries/requirements/list', adminT)).data.requirements;
const myReq = reqs.find(x => x.title === 'Need 1 more video editor');
ok('head raises requirement → admin inbox', !!myReq);
r = await req('POST', `/queries/requirements/${myReq.id}/convert`, adminT, { dueAt: new Date(Date.now() + 24 * 3600e3).toISOString() });
ok('requirement converts to task in one click', !!r.data.taskId);
r = await req('POST', '/queries/requirements', priya.token, { title: 'worker tries requirement' });
ok('worker cannot raise requirements (403)', r.status === 403);

console.log('— Reports chain —');
r = await req('POST', '/reports/my', priya.token, { summary: 'Finished all 21 assets', blockers: '' });
ok('worker files daily report', r.status === 200);
r = await req('GET', '/reports/team', aisha.token);
ok('manager sees team reports side by side', r.data.rows?.some(x => x.report?.summary === 'Finished all 21 assets'));
const priyaReportId = r.data.rows.find(x => x.user.id === uid.priya).report.id;
r = await req('POST', `/reports/${priyaReportId}/review`, aisha.token, { comment: 'Good work' });
ok('manager reviews report', r.status === 200);
r = await req('POST', '/reports/compile', aisha.token, { summary: 'Marketing: all deliverables done' });
ok('compile & forward team roll-up', r.status === 200 && r.data.included >= 1);
r = await req('POST', `/reports/${priyaReportId}/review`, rohan.token, { comment: 'sneaky' });
ok('other branch head cannot review report (403)', r.status === 403);
r = await req('GET', '/reports/day', adminT);
ok('admin day view aggregates company', r.status === 200 && Array.isArray(r.data.branches));
r = await req('GET', '/reports/day', aisha.token);
ok('day view is admin-only (403 for heads)', r.status === 403);

console.log('— PDF + archive —');
let res = await fetch(API + '/reports/day-pdf', { headers: { Authorization: `Bearer ${adminT}` } });
const pdfBuf = Buffer.from(await res.arrayBuffer());
ok('day report PDF generates', res.status === 200 && pdfBuf.slice(0, 4).toString() === '%PDF' && pdfBuf.length > 2000, `len=${pdfBuf.length}`);
r = await req('GET', '/reports/archive', adminT);
ok('PDF auto-saved to archive', r.data.items?.length >= 1);
res = await fetch(API + '/reports/day-pdf', { headers: { Authorization: `Bearer ${adminT}` } });
ok('archived PDF re-downloadable', res.status === 200);

console.log('— HR: leaves, holidays, stipends —');
const t2 = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
r = await req('POST', '/hr/leaves', priya.token, { type: 'CASUAL', startDate: t2, endDate: t2, reason: 'Family function' });
const leaveId = r.data?.leave?.id;
ok('worker applies for leave', !!leaveId);
r = await req('POST', `/hr/leaves/${leaveId}/decide`, rohan.token, { decision: 'APPROVED' });
ok('non-manager cannot decide leave (403)', r.status === 403);
r = await req('POST', `/hr/leaves/${leaveId}/decide`, aisha.token, { decision: 'APPROVED', note: 'Enjoy' });
ok('manager approves leave', r.status === 200);
r = await req('POST', '/hr/holidays', adminT, { dateKey: '2026-08-15', name: 'Independence Day' });
ok('admin sets company holiday', r.status === 200);
r = await req('POST', '/hr/holidays', aisha.token, { dateKey: '2026-08-20', name: 'Nope' });
ok('head cannot set holidays (403)', r.status === 403);
r = await req('GET', '/hr/stipends', adminT);
ok('stipend records auto-generated for the month', r.data.records?.length >= 4);
r = await req('GET', '/hr/stipends', aisha.token);
ok('stipends admin-only (403)', r.status === 403);
const rec = (await req('GET', '/hr/stipends', adminT)).data.records.find(x => x.user.username === 'priya' && x.kind === 'STIPEND');
r = await req('POST', `/hr/stipends/${rec.id}/pay`, adminT, { note: 'UPI ref 12345' });
ok('mark stipend paid', r.status === 200);
r = await req('POST', '/hr/stipends/bonus', adminT, { userId: uid.rahul, amount: 500, note: '7-day streak bonus' });
ok('manual bonus recorded', r.status === 200);

console.log('— Streak engine —');
r = await req('POST', '/streaks/adjust', adminT, { userId: uid.rahul, setTo: 6, reason: 'Migrated from old tracker' });
ok('admin manual streak adjust (logged)', r.status === 200);
r = await req('GET', '/streaks/me', (await login('rahul')).token);
ok('rahul sees adjusted streak', r.data.streak?.current === 6);
r = await req('POST', '/streaks/run', adminT);
ok('streak evaluation runs', r.status === 200);

console.log('— Videos —');
r = await req('POST', '/videos', adminT, { title: 'LinkedIn Posting Tutorial', category: 'LinkedIn posting', description: 'How we post', driveLink: 'https://drive.google.com/file/d/1a2B3c4D5e6F7g8H9i0JkLmNoPqRsTuVw/view?usp=sharing' });
const vidId = r.data?.video?.id;
ok('admin adds video from Drive link', !!vidId);
r = await req('GET', '/videos', priya.token);
const vjson = JSON.stringify(r.data);
ok('video list contains NO drive id/url', !vjson.includes('1a2B3c4D5e6F7g8H9i0JkLmNoPqRsTuVw') && !vjson.includes('drive.google.com'));
const priyaT = (await login('priya')).token;
r = await req('POST', `/videos/${vidId}/play`, priyaT);
ok('play returns embed path (no raw link)', r.data.embedPath?.startsWith('/api/videos/embed/') && !JSON.stringify(r.data).includes('drive.google.com'));
res = await fetch('http://localhost:4000' + r.data.embedPath);
const html = await res.text();
ok('embed page server-renders player + watermark with viewer name', html.includes('drive.google.com/file/d/') && html.includes('Priya Sharma'));
r = await req('GET', `/videos/${vidId}/viewers`, adminT);
ok('view logged for admin report', r.data.views?.some(v => v.user.username === 'priya'));
const aishaT2 = (await login('aisha')).token;
r = await req('GET', '/notifications', aishaT2);
ok('manager notified of video watch', r.data.notifications?.some(n => n.type === 'video' && /Priya .* watched/.test(n.title)));

console.log('— Vault —');
r = await req('POST', '/vault/items', adminT, { name: 'Canva Pro', plan: 'Teams', monthlyCost: 999, renewalDate: '2026-08-02', loginEmail: 'ops@asscher.ai', password: 'SuperSecret#42', otpPhone: '98xxxxxx10', otpHolder: 'Amit' });
const itemId = r.data?.item?.id;
ok('vault item created (password encrypted at rest)', !!itemId && r.data.item.hasPassword && !JSON.stringify(r.data).includes('SuperSecret'));
r = await req('GET', '/vault/items', aishaT2);
ok('unshared head sees nothing', r.data.items.length === 0);
r = await req('POST', `/vault/items/${itemId}/reveal`, aishaT2);
ok('unshared reveal blocked (403)', r.status === 403);
await req('POST', `/vault/items/${itemId}/share`, adminT, { userId: uid.aisha });
r = await req('POST', `/vault/items/${itemId}/reveal`, aishaT2);
ok('shared head reveals password', r.data.password === 'SuperSecret#42');
r = await req('GET', `/vault/items/${itemId}/logs`, adminT);
ok('reveal is logged', r.data.logs?.some(l => l.user.username === 'aisha'));

console.log('— Offboarding —');
const rahulT = (await login('rahul')).token;
await req('POST', '/tasks', adminT, { title: 'Open task for rahul', assigneeIds: [uid.rahul] });
r = await req('POST', `/users/${uid.rahul}/deactivate`, adminT);
ok('deactivate user', r.status === 200);
r = await req('GET', '/auth/me', rahulT);
ok('deactivation kills live session mid-use', r.status === 401);
r = await login('rahul');
ok('deactivated user cannot log back in', !r.token);
r = await req('GET', `/users/${uid.rahul}/exit-checklist`, adminT);
ok('exit checklist lists open tasks', r.data.openTasks?.length >= 1);
r = await req('GET', `/users/${uid.rahul}`, adminT);
ok('exited user data retained & queryable', r.status === 200 && r.data.user.status === 'EXITED');

console.log('— Search & dashboard & audit —');
r = await req('GET', '/search?q=LinkedIn', priyaT);
ok('scoped search works', r.status === 200 && Array.isArray(r.data.tasks));
r = await req('GET', '/search?q=Canva', priyaT);
ok('vault items hidden from unshared users in search', r.data.vault.length === 0);
r = await req('GET', '/dashboard', adminT);
ok('admin dashboard pulse', r.status === 200 && r.data.admin && Array.isArray(r.data.admin.byDept));
r = await req('GET', '/dashboard', priyaT);
ok('worker dashboard', r.status === 200 && !r.data.admin);
r = await req('GET', '/activity', aishaT2);
ok('head sees subtree activity only', r.status === 200 && r.data.logs.every(l => !l.actorId || [uid.aisha, uid.priya, uid.rahul].includes(l.actorId)));
r = await req('GET', '/activity', adminT);
ok('admin sees full audit log', r.status === 200 && r.data.total > 20);
r = await req('GET', '/auth/sessions', adminT);
ok('admin sessions panel lists active sessions', r.data.sessions?.length >= 2);

console.log(`\n========== ${pass} passed, ${fail} failed ==========`);
process.exit(fail ? 1 : 0);
