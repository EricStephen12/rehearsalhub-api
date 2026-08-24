require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  prepare: false,
});

async function main() {
  console.log('📦 Initializing user_follows table in PostgreSQL...');

  await sql`
    CREATE TABLE IF NOT EXISTS "user_follows" (
      "id" text PRIMARY KEY,
      "follower_id" text NOT NULL,
      "following_id" text NOT NULL,
      "created_at" timestamp DEFAULT now(),
      CONSTRAINT unique_follower_following UNIQUE ("follower_id", "following_id")
    );
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON "user_follows" ("follower_id");`;
  await sql`CREATE INDEX IF NOT EXISTS idx_user_follows_following ON "user_follows" ("following_id");`;

  console.log('✅ user_follows table & indexes initialized successfully!');
  await sql.end();
}

main().catch(err => {
  console.error('Error creating follows table:', err);
  process.exit(1);
});
