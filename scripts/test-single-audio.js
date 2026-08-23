require('dotenv').config({ path: 'c:/Users/Eric/Pictures/workholiday/rehearsalhub-api/.env' });
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const bucketName = process.env.R2_BUCKET_NAME;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const publicUrlBase = process.env.R2_PUBLIC_URL.replace(/\/+$/, '');

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

async function run() {
  const url = 'https://res.cloudinary.com/dvtjjt3js/video/upload/v1768666149/loveworld-singers/audio/qdk2gclslkqojz4lmxzf.mp3';
  console.log('1. Downloading 10 MB audio track from Cloudinary...');
  const start = Date.now();
  const res = await fetch(url);
  console.log(`HTTP ${res.status} in ${(Date.now() - start) / 1000}s`);

  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`Downloaded ${Math.round(buf.length / 1024 / 1024 * 10) / 10} MB`);

  console.log('2. Uploading to Cloudflare R2...');
  const key = 'ministered_songs/loveworld-singers/audio/qdk2gclslkqojz4lmxzf.mp3';
  await r2.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buf,
    ContentType: 'audio/mpeg',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  const r2Url = `${publicUrlBase}/${key}`;
  console.log(`✅ Uploaded to Cloudflare R2: ${r2Url}`);

  console.log('3. Verifying public streaming from Cloudflare R2...');
  const checkRes = await fetch(r2Url, { method: 'HEAD' });
  console.log(`Public R2 Status: ${checkRes.status} ${checkRes.statusText}`);
  console.log(`Content-Type: ${checkRes.headers.get('content-type')}`);
  console.log(`Content-Length: ${checkRes.headers.get('content-length')}`);
}

run().catch(console.error);
