require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  prepare: false,
});

async function main() {
  console.log('📦 Initializing Moments / Social Community tables in PostgreSQL...');

  await sql`
    CREATE TABLE IF NOT EXISTS "moments" (
      "id" text PRIMARY KEY,
      "user_id" text NOT NULL,
      "user_name" text,
      "user_avatar" text,
      "zone_id" text DEFAULT 'hq',
      "zone_name" text,
      "type" text DEFAULT 'photo',
      "media_urls" jsonb,
      "caption" text,
      "tags" jsonb,
      "song_id" text,
      "song_title" text,
      "likes_count" integer DEFAULT 0,
      "comments_count" integer DEFAULT 0,
      "shares_count" integer DEFAULT 0,
      "is_pinned" boolean DEFAULT false,
      "created_at" timestamp DEFAULT now(),
      "updated_at" timestamp DEFAULT now(),
      "raw_data" jsonb
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "moment_likes" (
      "id" text PRIMARY KEY,
      "moment_id" text NOT NULL,
      "user_id" text NOT NULL,
      "user_name" text,
      "user_avatar" text,
      "created_at" timestamp DEFAULT now()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "moment_comments" (
      "id" text PRIMARY KEY,
      "moment_id" text NOT NULL,
      "user_id" text NOT NULL,
      "user_name" text,
      "user_avatar" text,
      "content" text NOT NULL,
      "created_at" timestamp DEFAULT now(),
      "raw_data" jsonb
    );
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_moments_created_at ON "moments" ("created_at" DESC);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_moments_zone_id ON "moments" ("zone_id");`;
  await sql`CREATE INDEX IF NOT EXISTS idx_moment_likes_moment_id ON "moment_likes" ("moment_id");`;
  await sql`CREATE INDEX IF NOT EXISTS idx_moment_likes_user_id ON "moment_likes" ("user_id");`;
  await sql`CREATE INDEX IF NOT EXISTS idx_moment_comments_moment_id ON "moment_comments" ("moment_id");`;

  console.log('✅ Moments, Moment Likes, and Moment Comments tables successfully initialized with indexes!');
  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Error creating tables:', err);
  await sql.end();
  process.exit(1);
});
