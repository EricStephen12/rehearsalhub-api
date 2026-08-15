/**
 * Live smoke: Admin-read table shapes + DTO mappers (no HTTP server required).
 */
import 'dotenv/config';
import { sql, asc } from 'drizzle-orm';

async function main(): Promise<void> {
  const { db } = await import('../src/db');
  const {
    activityLogs,
    categories,
    praiseNights,
    schedulePrograms,
    submittedSongs,
    masterSongs,
    profiles,
  } = await import('../src/schema');
  const { mergeRawRow } = await import('../src/lib/rawRow');

  // activity_logs — SQL limit/sort like the route
  const activityResult = await db.execute(sql`
    SELECT id, raw_data AS "rawData"
    FROM activity_logs
    ORDER BY COALESCE(
      (raw_data->'timestamp'->>'_seconds')::bigint,
      (raw_data->'createdAt'->>'_seconds')::bigint,
      0
    ) DESC
    LIMIT 100
  `);
  const activityRows = activityResult as unknown as Array<{ id: string; rawData: unknown }>;
  const activityMapped = activityRows.map((r) => mergeRawRow({ id: r.id, rawData: r.rawData }));
  console.log('activity-logs:', activityMapped.length, 'sample action:', activityMapped[0]?.action);

  const catRows = await db.select().from(categories);
  const cats = catRows.map((r) => {
    const m = mergeRawRow(r);
    return { id: m.id, name: m.name, color: m.color, isActive: m.isActive !== false };
  });
  console.log('categories:', cats.length, 'sample:', cats[0]?.name);

  const nights = await db.select().from(praiseNights);
  console.log('praise-nights:', nights.length, 'sample name:', nights[0]?.name);

  const programs = await db.select().from(schedulePrograms);
  console.log('schedule_programs:', programs.length, 'sample:', programs[0]?.name);

  const submitted = await db.select().from(submittedSongs);
  const submittedMapped = submitted.map((r) => {
    const m = mergeRawRow(r);
    return { id: m.id, title: m.title, writer: m.writer, zoneName: m.zoneName, status: m.status };
  });
  console.log('submitted-songs:', submittedMapped.length, 'sample writer:', submittedMapped[0]?.writer);

  const masters = await db.select().from(masterSongs).orderBy(asc(masterSongs.title)).limit(5);
  console.log('master_songs sample:', masters.length, masters[0]?.title);

  const directory = await db.select({ id: profiles.id }).from(profiles).limit(5);
  console.log('profiles directory sample:', directory.length);

  // unused import guard for activityLogs table presence in schema
  void activityLogs;

  if (
    activityMapped.length === 0 ||
    cats.length === 0 ||
    nights.length === 0 ||
    programs.length === 0 ||
    submittedMapped.length === 0 ||
    masters.length === 0 ||
    directory.length === 0
  ) {
    throw new Error('Unexpected empty collection in smoke');
  }

  console.log('ADMIN READ SMOKE PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
