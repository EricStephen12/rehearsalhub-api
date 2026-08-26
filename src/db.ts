import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { AsyncLocalStorage } from 'async_hooks';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

// Resilient postgres client configuration for cloud deployments (Railway/Supabase/Neon)
export const rawPgClient = postgres(connectionString, {
  ssl: 'require',
  max: 8,
  prepare: false,  // required for Supabase pgbouncer pooler
  idle_timeout: 10,
  connect_timeout: 30,
  max_lifetime: 60 * 15,
});

export const baseDb = drizzle(rawPgClient, { schema });

export const dbStorage = new AsyncLocalStorage<PostgresJsDatabase<typeof schema>>();

/**
 * db is a transparent Proxy. When an AsyncLocalStorage context (such as a per-request transaction)
 * is active, all queries execute on that transaction; otherwise they fall back to baseDb.
 * This guarantees zero route files need to be touched.
 */
export const db = new Proxy(baseDb, {
  get(target, prop, receiver) {
    const active = dbStorage.getStore();
    const client = active || target;
    const value = Reflect.get(client as any, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
}) as PostgresJsDatabase<typeof schema>;
