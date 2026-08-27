import 'dotenv/config';
import './src/index';
import { signAccessToken } from './src/auth/token';
import { db } from './src/db';
import { sql } from 'drizzle-orm';

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('Waiting for API server startup...');
  await wait(2000);

  const BASE_URL = `http://localhost:${process.env.PORT || 3001}`;
  console.log(`Connected to API at: ${BASE_URL}`);

  const token088 = signAccessToken({
    sub: 'user_test_088',
    role: 'zone_admin',
    zoneId: 'zone-088',
  });

  const token001 = signAccessToken({
    sub: 'user_test_001',
    role: 'zone_admin',
    zoneId: 'zone-001',
  });

  console.log('\n======================================================');
  console.log('CHECK 1: WRITE-ISOLATION & TENANT SPOOFING REJECTION');
  console.log('======================================================');

  // Attempt 1: User A (zone-088) normal submission
  console.log('\n[Attempt 1] User A (zone-088) -> Normal POST /submitted-songs:');
  const res1 = await fetch(`${BASE_URL}/submitted-songs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token088}`,
    },
    body: JSON.stringify({
      title: 'Valid Zone-088 Song',
      writer: 'Singer 088',
    }),
  });
  const data1 = await res1.json();
  console.log('HTTP Status:', res1.status);
  console.log('Response:', JSON.stringify(data1, null, 2));

  // Attempt 2: User A (zone-088) spoofed submission with zone_id: 'zone-001'
  console.log('\n[Attempt 2] User A (zone-088) -> Spoofed POST /submitted-songs (zone_id: zone-001):');
  const res2 = await fetch(`${BASE_URL}/submitted-songs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token088}`,
    },
    body: JSON.stringify({
      title: 'Spoofed Zone-001 Song Attempt',
      zoneId: 'zone-001',
    }),
  });
  const data2 = await res2.json();
  console.log('HTTP Status:', res2.status);
  console.log('Response:', JSON.stringify(data2, null, 2));

  // Attempt 3: User B (zone-001) normal check-in
  console.log('\n[Attempt 3] User B (zone-001) -> Normal POST /attendance/check-in:');
  const res3 = await fetch(`${BASE_URL}/attendance/check-in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token001}`,
    },
    body: JSON.stringify({
      eventName: 'Sunday Morning Service',
      userName: 'Singer 001',
    }),
  });
  const data3 = await res3.json();
  console.log('HTTP Status:', res3.status);
  console.log('Response:', JSON.stringify(data3, null, 2));

  // Attempt 4: User B (zone-001) spoofed check-in with zone_id: 'zone-088'
  console.log('\n[Attempt 4] User B (zone-001) -> Spoofed POST /attendance/check-in (zone_id: zone-088):');
  const res4 = await fetch(`${BASE_URL}/attendance/check-in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token001}`,
    },
    body: JSON.stringify({
      eventName: 'Cross-Zone Checkin Attack',
      zoneId: 'zone-088',
    }),
  });
  const data4 = await res4.json();
  console.log('HTTP Status:', res4.status);
  console.log('Response:', JSON.stringify(data4, null, 2));

  console.log('\n======================================================');
  console.log('CHECK 2: CLOUDFLARE R2 UPLOAD & URL VERIFICATION');
  console.log('======================================================');

  // Test real upload to /upload endpoint using global FormData & Blob
  console.log('\n--- 1. Live Upload to Cloudflare R2 via /upload ---');
  const formData = new FormData();
  const fileBlob = new Blob([Buffer.from('RIFF....WAVEfmt ....data....', 'utf-8')], { type: 'audio/mpeg' });
  formData.append('file', fileBlob, `test_song_${Date.now()}.mp3`);
  formData.append('folder', 'audio');

  const uploadRes = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token088}`,
    },
    body: formData,
  });
  const uploadData: any = await uploadRes.json();
  console.log('Upload HTTP Status:', uploadRes.status);
  console.log('Upload Response Body:', JSON.stringify(uploadData, null, 2));

  // Query 5 songs from DB
  console.log('\n--- 2. DB Query for 5 Songs with Audio Files ---');
  const query5 = await db.execute(sql`
    SELECT id, title, audio_file 
    FROM songs 
    WHERE audio_file IS NOT NULL AND audio_file != ''
    ORDER BY updated_at DESC 
    LIMIT 5;
  `);
  console.log('5 Songs Query Output:');
  console.log(JSON.stringify(query5, null, 2));

  // Directly fetch 2 of those R2 URLs
  console.log('\n--- 3. Direct HTTP HEAD/GET Fetch on 2 R2 Audio URLs ---');
  const urlsToTest = (query5 as any[]).slice(0, 2).map((s) => s.audio_file);
  for (const url of urlsToTest) {
    try {
      const headRes = await fetch(url, { method: 'HEAD' });
      console.log(`URL: ${url}`);
      console.log(`HTTP Status: ${headRes.status} ${headRes.statusText}`);
      console.log(`Content-Type: ${headRes.headers.get('content-type')}`);
      console.log(`Content-Length: ${headRes.headers.get('content-length')} bytes`);
    } catch (e: any) {
      console.error(`Failed to fetch ${url}:`, e.message);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL ERROR:', e);
  process.exit(1);
});
