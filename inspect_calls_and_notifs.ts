import 'dotenv/config';
import { rawPgClient } from './src/db';

async function main() {
  console.log('=== 1. CALLS TABLE SAMPLE ROWS ===');
  const callsSample = await rawPgClient`SELECT * FROM calls LIMIT 5;`;
  console.log('Calls count:', callsSample.length);
  console.log(JSON.stringify(callsSample, null, 2));

  console.log('\n=== 2. NOTIFICATIONS TABLE SAMPLE ROWS ===');
  const notifsSample = await rawPgClient`SELECT id, is_read, target_user_id, raw_data FROM notifications LIMIT 5;`;
  console.log('Notifs sample:');
  console.log(JSON.stringify(notifsSample, null, 2));

  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
