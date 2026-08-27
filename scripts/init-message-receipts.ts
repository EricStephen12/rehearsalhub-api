import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', prepare: false });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS message_receipts (
      id text PRIMARY KEY,
      message_id text NOT NULL,
      recipient_id text NOT NULL,
      device_id text NOT NULL,
      status text NOT NULL CHECK (status IN ('delivered', 'read')),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (message_id, recipient_id, device_id)
    );
    CREATE INDEX IF NOT EXISTS message_receipts_message_idx ON message_receipts (message_id);
    CREATE INDEX IF NOT EXISTS message_receipts_recipient_idx ON message_receipts (recipient_id);
  `;
  console.log('message_receipts table is ready');
} finally {
  await sql.end();
}