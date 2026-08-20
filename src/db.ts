import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

// Resilient postgres client configuration for cloud deployments (Railway/Supabase/Neon)
const client = postgres(connectionString, {
  ssl: 'require',
  max: 20,
  prepare: false,  // required for Supabase pgbouncer pooler
  idle_timeout: 30,
  connect_timeout: 30,
  max_lifetime: 60 * 30, // recycle connections every 30 minutes
});

export const db = drizzle(client, { schema });
