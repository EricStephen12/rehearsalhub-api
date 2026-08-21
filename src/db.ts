import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

// Resilient postgres client configuration for cloud deployments (Railway/Supabase/Neon)
const client = postgres(connectionString, {
  ssl: 'require',
  max: 8,
  prepare: false,  // required for Supabase pgbouncer pooler
  idle_timeout: 10,
  connect_timeout: 30,
  max_lifetime: 60 * 15,
});

export const db = drizzle(client, { schema });
