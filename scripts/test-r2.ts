import 'dotenv/config';
import { uploadToR2 } from '../src/services/r2Service';

async function main() {
  console.log('Testing Cloudflare R2 Upload...');
  const sampleBuffer = Buffer.from('Hello Loveworld Singers - Cloudflare R2 is working perfectly!');
  const result = await uploadToR2(sampleBuffer, {
    folder: 'test',
    filename: 'test.txt',
    contentType: 'text/plain',
  });

  console.log('✅ Upload Successful!');
  console.log('Key:', result.key);
  console.log('Public URL:', result.url);
  console.log('Size:', result.size, 'bytes');

  // Verify fetch
  const res = await fetch(result.url);
  console.log('Fetch status:', res.status);
  const text = await res.text();
  console.log('Fetched text content:', text);
}

main().catch((err) => {
  console.error('❌ R2 Test Failed:', err);
  process.exit(1);
});
