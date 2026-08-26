import 'dotenv/config';
import { rawPgClient } from './src/db';

async function main() {
  const tables = await rawPgClient`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
  console.log('ALL EXISTING TABLES IN DB:');
  console.log(tables.map(t => t.table_name));
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
