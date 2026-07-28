import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePrimaryAdmin, AuthedRequest, forbidden, clientIp } from '../middleware/auth';
import { getScope, canSeeUser } from '../lib/org';
import { logActivity } from '../lib/audit';
import { notify, primaryAdminId } from '../lib/notify';
import { fmtIST } from '../lib/time';

const router = Router();

export function extractDriveFileId(input: string): string | null {
  if (!input) return null;
  const s = String(input).trim();
  const m1 = s.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m1) return m1[1];
  const m2 = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m2) return m2[1];
  const m3 = s.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m3) return m3[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

// ---------- LIBRARY (drive id NEVER leaves the server) ----------
router.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const videos = await prisma.video.findMany({
    where: { active: true },
    orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
    select: { id: true, title: true, category: true, description: true, createdAt: true }, // no driveFileId
  });
  const myViews = await prisma.videoView.findMany({ where: { userId: req.user.id }, select: { videoId: true } });
  const watched = new Set(myViews.map((v) => v.videoId));
  res.json({ videos: videos.map((v) => ({ ...v, watchedByMe: watched.has(v.id) })) });
});

router.post('/', requireAuth, requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const { title, category, description, driveLink } = req.body || {};
  const fileId = extractDriveFileId(driveLink);
  if (!title || !category || !fileId) return res.status(400).json({ error: 'Title, category and a valid Google Drive link are required.' });
  const v = await prisma.video.create({ data: { title, category, description: description || null, driveFileId: fileId, addedById: req.user.id } });
  await logActivity({ actorId: req.user.id, type: 'VIDEO_ADDED', detail: `Added training video "${title}" (${category})` });
  res.json({ video: { id: v.id, title: v.title, category: v.category, description: v.description } });
});

router.patch('/:id', requireAuth, requirePrimaryAdmin, async (req: AuthedRequest, res) => {
  const b = req.body || {};
  const data: any = {};
  for (const f of ['title', 'category', 'description'] as const) if (b[f] !== undefined) data[f] = b[f];
  if (b.driveLink) {
    const fid = extractDriveFileId(b.driveLink);
    if (!fid) return res.status(400).json({ error: 'Invalid Drive link' });
    data.driveFileId = fid;
  }
  if (b.active !== undefined) data.active = !!b.active;
  const v = await prisma.video.update({ where: { id: req.params.id }, data });
  res.json({ video: { id: v.id, title: v.title, category: v.category, description: v.description, active: v.active } });
});

// ---------- PLAY: creates a view log + short-lived playback token ----------
router.post('/:id/play', requireAuth, async (req: AuthedRequest, res) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video || !video.active) return res.status(404).json({ error: 'Video not found' });

  const view = await prisma.videoView.create({ data: { videoId: video.id, userId: req.user.id } });
  const token = crypto.randomBytes(24).toString('hex');
  await prisma.playbackToken.create({
    data: { token, videoId: video.id, userId: req.user.id, viewId: view.id, expiresAt: new Date(Date.now() + 6 * 3600 * 1000) },
  });

  await logActivity({ actorId: req.user.id, type: 'VIDEO_VIEWED', detail: `Watched "${video.title}"`, meta: { videoId: video.id }, ip: clientIp(req) });
  const when = fmtIST(new Date(), 'h:mm A');
  const targets = new Set<string>();
  if (req.user.managerId) targets.add(req.user.managerId);
  const adminId = await primaryAdminId();
  if (adminId && adminId !== req.user.id) targets.add(adminId);
  if (targets.size) {
    await notify([...targets], { type: 'video', title: `${req.user.name} watched "${video.title}" at ${when}`, link: `/videos/${video.id}` });
  }
  res.json({ embedPath: `/api/videos/embed/${token}`, viewId: view.id, title: video.title });
});

// ---------- PROTECTED EMBED PAGE (server-rendered; loaded in an <iframe>) ----------
// NOTE (honest engineering): no web app can fully prevent screenshots or screen
// recording on the viewer's device. This page implements deterrents: the Drive id
// stays server-side, playback is watermarked with the viewer's name + live
// timestamp, right-click/selection/download affordances are disabled, and every
// view is logged and notified. Set the Drive file itself to viewer-only with
// download disabled.
router.get('/embed/:token', async (req, res) => {
  const t = await prisma.playbackToken.findUnique({ where: { token: req.params.token } });
  if (!t || t.expiresAt < new Date()) return res.status(403).send('<h3 style="font-family:sans-serif">This playback link has expired. Reopen the video from the app.</h3>');
  const video = await prisma.video.findUnique({ where: { id: t.videoId } });
  const viewer = await prisma.user.findUnique({ where: { id: t.userId }, select: { name: true, username: true } });
  if (!video || !viewer) return res.status(404).send('Not found');

  const wm = `${viewer.name} (@${viewer.username})`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // framed by our SPA via allowed origins below
  res.removeHeader('X-Frame-Options');
  res.send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(video.title)} — Asscher AI</title>
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden;-webkit-user-select:none;user-select:none}
  .frame{position:absolute;inset:0}
  iframe{width:100%;height:100%;border:0}
  .wm{position:absolute;inset:0;pointer-events:none;z-index:10;display:flex;flex-wrap:wrap;align-content:space-around;justify-content:space-around;overflow:hidden}
  .wm span{color:rgba(255,255,255,.22);font:600 13px/1.2 system-ui,sans-serif;transform:rotate(-24deg);white-space:nowrap;padding:34px 44px;text-shadow:0 0 2px rgba(0,0,0,.4)}
  .shield{position:absolute;top:0;right:0;width:64px;height:64px;z-index:20;background:transparent}
</style></head>
<body oncontextmenu="return false">
  <div class="frame"><iframe src="https://drive.google.com/file/d/${video.driveFileId}/preview" allow="autoplay; fullscreen" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation"></iframe></div>
  <div class="wm" id="wm"></div>
  <div class="shield" title=""></div>
<script>
  var name=${JSON.stringify(wm)};
  function stamp(){
    var d=new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:true});
    var el=document.getElementById('wm');el.innerHTML='';
    for(var i=0;i<12;i++){var s=document.createElement('span');s.textContent=name+' · '+d;el.appendChild(s);}
  }
  stamp();setInterval(stamp,30000);
  document.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&['s','p','u'].indexOf(e.key.toLowerCase())>-1)e.preventDefault();});
  // watch-duration pings (15s heartbeat while the tab is visible)
  var secs=0;setInterval(function(){
    if(document.visibilityState==='visible'){secs+=15;
      fetch('${''}/api/videos/embed/${req.params.token}/ping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seconds:15})}).catch(function(){});
    }},15000);
</script>
</body></html>`);
});

// duration ping from the embed page (validated by the playback token, not a session)
router.post('/embed/:token/ping', async (req, res) => {
  const t = await prisma.playbackToken.findUnique({ where: { token: req.params.token } });
  if (!t || t.expiresAt < new Date()) return res.status(403).json({ ok: false });
  const add = Math.min(Math.max(Number(req.body?.seconds) || 0, 0), 60);
  await prisma.videoView.update({ where: { id: t.viewId }, data: { durationSec: { increment: add }, lastPingAt: new Date() } });
  res.json({ ok: true });
});

// ---------- REPORTS ----------
// Per-video viewer report (admin: everyone; heads: their subtree's views)
router.get('/:id/viewers', requireAuth, async (req: AuthedRequest, res) => {
  const { ids } = await getScope(req.user);
  const views = await prisma.videoView.findMany({
    where: { videoId: req.params.id, userId: { in: [...ids] } },
    include: { user: { select: { id: true, name: true, username: true } } },
    orderBy: { openedAt: 'desc' },
    take: 300,
  });
  res.json({ views });
});

// Per-user training history (self, their managers, admin)
router.get('/history/user/:id', requireAuth, async (req: AuthedRequest, res) => {
  if (!(await canSeeUser(req.user, req.params.id))) return forbidden(res);
  const views = await prisma.videoView.findMany({
    where: { userId: req.params.id },
    include: { video: { select: { id: true, title: true, category: true } } },
    orderBy: { openedAt: 'desc' },
    take: 300,
  });
  res.json({ views });
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export default router;
