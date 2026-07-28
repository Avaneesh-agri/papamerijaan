// Optional demo organisation (run: npm run db:seed). Safe to skip in production.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';

async function main() {
  const pass = (p: string) => bcrypt.hash(p, 10);
  const existing = await prisma.user.findFirst({ where: { isPrimaryAdmin: true } });
  const admin =
    existing ||
    (await prisma.user.create({
      data: {
        name: process.env.SEED_ADMIN_NAME || 'Primary Admin',
        username: (process.env.SEED_ADMIN_USERNAME || 'admin').toLowerCase(),
        email: (process.env.SEED_ADMIN_EMAIL || 'admin@asscher.ai').toLowerCase(),
        phone: '9800000001',
        passwordHash: await pass(process.env.SEED_ADMIN_PASSWORD || 'ChangeMe@123'),
        isPrimaryAdmin: true,
        department: 'Head Office',
      },
    }));
  await prisma.streak.upsert({ where: { userId: admin.id }, update: {}, create: { userId: admin.id } });

  if (process.env.SEED_DEMO_DATA !== 'true') {
    console.log('Primary Admin ready. (Set SEED_DEMO_DATA=true to also create a demo org.)');
    return;
  }

  const mk = async (d: any) => {
    const u = await prisma.user.upsert({
      where: { username: d.username },
      update: {},
      create: { ...d, passwordHash: await pass('Password@123'), phone: d.phone || '9800000000' },
    });
    await prisma.streak.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id } });
    return u;
  };

  const headA = await mk({ name: 'Aisha Khan', username: 'aisha', email: 'aisha@asscher.ai', department: 'Marketing', managerId: admin.id, stipendAmount: 15000, payDay: 5 });
  const headB = await mk({ name: 'Rohan Mehta', username: 'rohan', email: 'rohan@asscher.ai', department: 'Design', managerId: admin.id, stipendAmount: 15000, payDay: 5 });
  await mk({ name: 'Priya Sharma', username: 'priya', email: 'priya@asscher.ai', managerId: headA.id, department: 'Marketing', stipendAmount: 8000, payDay: 5 });
  await mk({ name: 'Rahul Verma', username: 'rahul', email: 'rahul@asscher.ai', managerId: headA.id, department: 'Marketing', stipendAmount: 8000, payDay: 5 });
  await mk({ name: 'Sneha Iyer', username: 'sneha', email: 'sneha@asscher.ai', managerId: headB.id, department: 'Design', stipendAmount: 8000, payDay: 5 });

  console.log('Demo org created. All demo users have password: Password@123');
}

main().finally(() => prisma.$disconnect());
