import 'dotenv/config';
import { db } from './src/db';
import { profiles, hqMembers } from './src/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

const STANDARD_HQ_ADMINS = [
  'ihenacho23@gmail.com',       
  'ephraimloveworld1@gmail.com', 
  'takeshopstores@gmail.com',   
  'nnennawealth@gmail.com',     
  'joykures@gmail.com',         
  'styleirech@gmail.com',       
  'usmanrazaqj@gmail.com',      
];

const SPECIAL_EMAILS = [
  'president@loveworldhq.org',
  'thepresident2@loveworld.com',
  'director@loveworldhq.org',
  'oftp.daba@loveworldhq.org',
  'oftp.bisola@loveworldhq.org',
  'oftp.rita@loveworldhq.org'
];

async function run() {
  console.log('--- Starting Role Upgrade ---');
  
  let hqAdminCount = 0;
  for (const email of STANDARD_HQ_ADMINS) {
    const rows = await db.select().from(profiles).where(eq(profiles.email, email));
    
    if (rows.length > 0) {
      const user = rows[0];
      
      let rawData = user.rawData || {};
      if (typeof rawData === 'string') {
        try { rawData = JSON.parse(rawData); } catch(e) {}
      }
      
      rawData.role = 'hq_admin';
      rawData.hasHqAccess = true;
      rawData.canSeeArchive = true;
      rawData.canAccessArchive = true;
      
      await db.update(profiles)
        .set({
          role: 'hq_admin',
          hasHqAccess: true,
          rawData: rawData
        })
        .where(eq(profiles.id, user.id));
        
      const existingHq = await db.select().from(hqMembers).where(eq(hqMembers.userId, user.id));
      if (existingHq.length === 0) {
         await db.insert(hqMembers).values({
            id: crypto.randomUUID(),
            userId: user.id,
            role: 'hq_admin',
            status: 'active',
            hqGroupId: 'loveworld-singers-hq',
            rawData: { addedByScript: true }
         });
      }
      
      console.log(`[HQ ADMIN SUCCESS] Upgraded: ${email}`);
      hqAdminCount++;
    } else {
      console.log(`[HQ ADMIN SKIPPED] Not found in DB: ${email}`);
    }
  }

  let specialCount = 0;
  for (const email of SPECIAL_EMAILS) {
    const rows = await db.select().from(profiles).where(eq(profiles.email, email));
    
    if (rows.length > 0) {
      const user = rows[0];
      
      let rawData = user.rawData || {};
      if (typeof rawData === 'string') {
        try { rawData = JSON.parse(rawData); } catch(e) {}
      }
      
      // DO NOT SET role = 'hq_admin'. Keep their current role.
      // Just give them access flags.
      rawData.hasHqAccess = true;
      rawData.canSeeArchive = true;
      rawData.canAccessArchive = true;
      
      await db.update(profiles)
        .set({
          hasHqAccess: true,
          rawData: rawData
        })
        .where(eq(profiles.id, user.id));
        
      console.log(`[SPECIAL SUCCESS] Updated access flags: ${email}`);
      specialCount++;
    } else {
      console.log(`[SPECIAL SKIPPED] Not found in DB: ${email}`);
    }
  }

  console.log(`--- Finished! Upgraded ${hqAdminCount} HQ Admins and ${specialCount} Special accounts. ---`);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
