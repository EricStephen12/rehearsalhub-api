import 'dotenv/config';
import { rawPgClient } from './src/db';

async function main() {
  const result = await rawPgClient`SELECT count(*) FROM notifications`;
  console.log('NOTIFICATIONS_COUNT:', result);
  process.exit(0);
}

main().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
