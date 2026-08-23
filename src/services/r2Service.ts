import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || 'b2e5411830e116cf4ce6e91e90843db0';
const bucketName = process.env.R2_BUCKET_NAME || 'rehearsalhub-media';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const publicUrlBase = (process.env.R2_PUBLIC_URL || 'https://pub-cb7697578fcc48d3b3aeb70a47eb2f65.r2.dev').replace(/\/+$/, '');

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

export interface UploadOptions {
  folder?: string;
  filename?: string;
  contentType?: string;
  cacheControl?: string;
}

export async function uploadToR2(
  fileBuffer: Buffer,
  options: UploadOptions = {}
): Promise<{ url: string; key: string; size: number }> {
  const folder = (options.folder || 'general').replace(/^\/+|\/+$/g, '');
  const ext = options.filename ? options.filename.split('.').pop() : 'bin';
  const randomSuffix = crypto.randomBytes(8).toString('hex');
  const safeFilename = options.filename
    ? `${pathSanitize(options.filename.replace(/\.[^/.]+$/, ''))}_${randomSuffix}.${ext}`
    : `${Date.now()}_${randomSuffix}.${ext}`;

  const key = folder ? `${folder}/${safeFilename}` : safeFilename;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: fileBuffer,
    ContentType: options.contentType || 'application/octet-stream',
    CacheControl: options.cacheControl || 'public, max-age=31536000, immutable',
  });

  await r2Client.send(command);

  const url = `${publicUrlBase}/${key}`;
  return {
    url,
    key,
    size: fileBuffer.length,
  };
}

export async function uploadToR2WithExactKey(
  fileBuffer: Buffer,
  exactKey: string,
  contentType?: string
): Promise<{ url: string; key: string; size: number }> {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: exactKey,
    Body: fileBuffer,
    ContentType: contentType || 'application/octet-stream',
    CacheControl: 'public, max-age=31536000, immutable',
  });

  await r2Client.send(command);

  const url = `${publicUrlBase}/${exactKey}`;
  return {
    url,
    key: exactKey,
    size: fileBuffer.length,
  };
}

export async function deleteFromR2(key: string): Promise<boolean> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    await r2Client.send(command);
    return true;
  } catch (error) {
    console.error('[R2] Error deleting object:', error);
    return false;
  }
}

export async function checkR2ObjectExists(key: string): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    await r2Client.send(command);
    return true;
  } catch {
    return false;
  }
}

export function getR2PublicUrl(key: string): string {
  return `${publicUrlBase}/${key}`;
}

function pathSanitize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 50);
}
