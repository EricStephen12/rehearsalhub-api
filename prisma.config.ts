import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL!;
const directUrl = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL!;

export default defineConfig({
  earlyAccess: true,
  schema: 'prisma/schema.prisma',
  migrate: {
    async adapter() {
      const pool = new pg.Pool({ connectionString: directUrl, ssl: { rejectUnauthorized: false } });
      return new PrismaPg(pool);
    },
  },
  client: {
    async adapter() {
      const pool = new pg.Pool({
        connectionString,
        ssl: { rejectUnauthorized: false },
        max: 8,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 30000,
      });
      return new PrismaPg(pool);
    },
  },
});
