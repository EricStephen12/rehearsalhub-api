import 'dotenv/config';
import http from 'http';
import app from './src/index';
import { signAccessToken } from './src/auth/token';

async function testHttpEndpoints() {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(3099, resolve));

  console.log('Test server listening on port 3099');

  // Generate tokens for two non-HQ users in different zones
  // User 1: Zone 088 (zone-088)
  const tokenZone088 = signAccessToken({
    sub: 'user_zone_088_test',
    role: 'zone_admin',
    zoneId: 'zone-088',
  });

  // User 2: Zone 001 (zone-001)
  const tokenZone001 = signAccessToken({
    sub: 'user_zone_001_test',
    role: 'zone_admin',
    zoneId: 'zone-001',
  });

  console.log('\n======================================================');
  console.log('TEST 1: GET /submitted-songs as User A (Zone: zone-088)');
  console.log('======================================================');
  const resA = await fetch('http://localhost:3099/submitted-songs', {
    headers: { Authorization: `Bearer ${tokenZone088}` },
  });
  const dataA: any = await resA.json();
  console.log('Status:', resA.status);
  console.log('Total Count Returned:', dataA.count ?? dataA.data?.length);
  console.log('Sample IDs & Titles:', (dataA.data || []).slice(0, 3).map((r: any) => ({
    id: r.id,
    title: r.title,
    zoneId: r.zoneId || r.zone_id,
  })));

  console.log('\n======================================================');
  console.log('TEST 2: GET /submitted-songs as User B (Zone: zone-001)');
  console.log('======================================================');
  const resB = await fetch('http://localhost:3099/submitted-songs', {
    headers: { Authorization: `Bearer ${tokenZone001}` },
  });
  const dataB: any = await resB.json();
  console.log('Status:', resB.status);
  console.log('Total Count Returned:', dataB.count ?? dataB.data?.length);
  console.log('Sample IDs & Titles:', (dataB.data || []).slice(0, 3).map((r: any) => ({
    id: r.id,
    title: r.title,
    zoneId: r.zoneId || r.zone_id,
  })));

  console.log('\n======================================================');
  console.log('TEST 3: GET /attendance as User A (Zone: zone-088)');
  console.log('======================================================');
  const resAttA = await fetch('http://localhost:3099/attendance', {
    headers: { Authorization: `Bearer ${tokenZone088}` },
  });
  const dataAttA: any = await resAttA.json();
  console.log('Status:', resAttA.status);
  console.log('Total Count Returned:', dataAttA.count ?? dataAttA.data?.length);
  console.log('Sample IDs:', (dataAttA.data || []).slice(0, 3).map((r: any) => ({
    id: r.id,
    userName: r.userName,
    zoneId: r.zoneId,
  })));

  console.log('\n======================================================');
  console.log('TEST 4: GET /attendance as User B (Zone: zone-001)');
  console.log('======================================================');
  const resAttB = await fetch('http://localhost:3099/attendance', {
    headers: { Authorization: `Bearer ${tokenZone001}` },
  });
  const dataAttB: any = await resAttB.json();
  console.log('Status:', resAttB.status);
  console.log('Total Count Returned:', dataAttB.count ?? dataAttB.data?.length);
  console.log('Sample IDs:', (dataAttB.data || []).slice(0, 3).map((r: any) => ({
    id: r.id,
    userName: r.userName,
    zoneId: r.zoneId,
  })));

  server.close();
  process.exit(0);
}

testHttpEndpoints().catch((e) => {
  console.error(e);
  process.exit(1);
});
