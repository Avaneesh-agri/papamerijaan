import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7 driver-adapter setup: no Rust engine binaries at build or runtime —
// deploys cleanly on any host. Connection via the pg driver.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  ...(process.env.DATABASE_URL?.includes('sslmode=require') ? { ssl: { rejectUnauthorized: false } } : {}),
});

export const prisma = new PrismaClient({ adapter });
