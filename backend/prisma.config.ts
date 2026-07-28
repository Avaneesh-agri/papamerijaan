// Prisma 7 configuration. The datasource URL is read from .env (DATABASE_URL).
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Falls back to a placeholder so `prisma generate` works before env vars exist.
    url: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/asscher_ai',
  },
});
