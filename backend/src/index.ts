import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { prisma } from './lib/prisma';
import { startJobs } from './lib/jobs';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import taskRoutes from './routes/tasks';
import reportRoutes from './routes/reports';
import queryRoutes from './routes/queries';
import hrRoutes from './routes/hr';
import streakRoutes from './routes/streaks';
import videoRoutes from './routes/videos';
import vaultRoutes from './routes/vault';
import miscRoutes from './routes/misc';

const app = express();
app.set('trust proxy', true);

// CORS: the frontend lives on a different platform — set FRONTEND_ORIGIN to its URL(s).
const origins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || origins.includes(origin) || origins.includes('*')) return cb(null, true);
      cb(null, false);
    },
    credentials: false, // bearer tokens, not cookies — simplest cross-platform setup
  })
);
app.use(express.json({ limit: '2mb' }));

app.get('/', (_req, res) => res.json({ ok: true, service: 'Asscher AI Operations API' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/queries', queryRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/streaks', streakRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api', miscRoutes);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large.' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (10 MB max).' });
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

async function ensurePrimaryAdmin() {
  const count = await prisma.user.count();
  if (count > 0) return;
  const name = process.env.SEED_ADMIN_NAME || 'Primary Admin';
  const username = (process.env.SEED_ADMIN_USERNAME || 'admin').toLowerCase();
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@asscher.ai').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe@123';
  const admin = await prisma.user.create({
    data: {
      name, username, email, phone: '0000000000',
      passwordHash: await bcrypt.hash(password, 10),
      isPrimaryAdmin: true, department: 'Head Office',
    },
  });
  await prisma.streak.create({ data: { userId: admin.id } });
  console.log(`\n★ Created Primary Admin → username: ${username}  password: ${password}\n  Change this password after first login.\n`);
}

const port = Number(process.env.PORT) || 4000;
app.listen(port, async () => {
  console.log(`Asscher AI API listening on :${port}`);
  try {
    await ensurePrimaryAdmin();
  } catch (e) {
    console.error('Primary admin bootstrap failed (is the database migrated? run: npx prisma db push)', e);
  }
  startJobs();
});
