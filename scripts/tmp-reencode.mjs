// One-off: re-encode the oversized listing photo in place. Deleted after use.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1).replace(/^['"]|['"]$/g, '')];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing Supabase URL or service role key in .env.local');

const BUCKET = 'item-images';
const PATH = '27cf7959-22ec-438d-9521-0cc8dc53c706/58c47b98-a223-4498-b3d1-e53677ad384c/0.jpg';
const MAX_EDGE = 4096;

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: original, error: downloadError } = await admin.storage.from(BUCKET).download(PATH);
if (downloadError || !original) throw new Error(`download failed: ${downloadError?.message}`);
const originalBytes = Buffer.from(await original.arrayBuffer());

const backupDir = join(process.env.USERPROFILE, 'Downloads', 'noditto-image-backup');
mkdirSync(backupDir, { recursive: true });
const backupPath = join(backupDir, PATH.replaceAll('/', '__'));
writeFileSync(backupPath, originalBytes);

const meta = await sharp(originalBytes, { limitInputPixels: false }).metadata();
console.log('original', { bytes: originalBytes.length, width: meta.width, height: meta.height, orientation: meta.orientation });

const { data: resized, info } = await sharp(originalBytes, { limitInputPixels: false })
  .rotate()
  .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 90, mozjpeg: true })
  .toBuffer({ resolveWithObject: true });
console.log('resized', { bytes: resized.length, width: info.width, height: info.height });

const { error: uploadError } = await admin.storage.from(BUCKET).update(PATH, resized, {
  contentType: 'image/jpeg',
  upsert: true,
});
if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

const { data: check } = await admin.storage.from(BUCKET).info(PATH);
console.log('stored', { size: check?.size, contentType: check?.contentType });
console.log('backup', backupPath);
console.log(JSON.stringify({ w: info.width, h: info.height }));
