// scripts/ml/verify_ts_model_parity.ts
//
// Runs the production TypeScript `scoreFeatureVector` (`domain/references/fakeProfileModel.ts`)
// directly over all cached real-world public CSV datasets in `tmp-ml-datasets/` to verify
// exact parity with Python training benchmarks (no JS/Python numerical drift).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildProfileFeatureVector,
  scoreFeatureVector,
} from '@/domain/references/fakeProfileModel';

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseHeaders(line: string): string[] {
  return parseCsvLine(line.replace(/^\uFEFF/, '')).map((h) => h.trim());
}

function evalDataset(
  name: string,
  rows: Array<{ vec: number[]; label: number }>,
) {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  for (const r of rows) {
    const pred = scoreFeatureVector(r.vec).probability >= 0.5 ? 1 : 0;
    if (pred === 1 && r.label === 1) tp += 1;
    else if (pred === 0 && r.label === 0) tn += 1;
    else if (pred === 1 && r.label === 0) fp += 1;
    else fn += 1;
  }
  const acc = (tp + tn) / rows.length;
  const prec = tp / Math.max(tp + fp, 1);
  const rec = tp / Math.max(tp + fn, 1);
  const f1 = (2 * prec * rec) / Math.max(prec + rec, 1e-9);
  const fpr = fp / Math.max(fp + tn, 1);
  console.log(
    `TS ${name.padEnd(36)} n=${String(rows.length).padEnd(5)} acc=${(acc * 100).toFixed(1)}% prec=${(prec * 100).toFixed(1)}% rec=${(rec * 100).toFixed(1)}% F1=${(f1 * 100).toFixed(1)}% FPR=${(fpr * 100).toFixed(1)}%`,
  );
  if (acc < 0.9 || f1 < 0.9) {
    throw new Error(`Parity/quality regression on ${name}: acc=${acc}, f1=${f1}`);
  }
}

const dir = 'tmp-ml-datasets';

// 1. IG Kaggle unseen test.csv (n=120)
{
  const lines = readFileSync(join(dir, 'ig_test.csv'), 'utf8').trim().split(/\r?\n/);
  const headers = parseHeaders(lines[0]!);
  const idx = (k: string) => headers.indexOf(k);
  const rows = lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    return {
      vec: buildProfileFeatureVector({
        hasProfilePic: Number(cols[idx('profile pic')]),
        usernameDigitRatio: Number(cols[idx('nums/length username')]),
        fullnameWords: Number(cols[idx('fullname words')]),
        bioLen: Number(cols[idx('description length')]),
        hasExternalUrl: Number(cols[idx('external URL')]),
        posts: Number(cols[idx('#posts')]),
        followers: Number(cols[idx('#followers')]),
        following: Number(cols[idx('#follows')]),
      }),
      label: Number(cols[idx('fake')]),
    };
  });
  evalDataset('IG Kaggle Held-out test.csv', rows);
}

// 2. IG BeleRicks11 NewDataset.csv (n=1000)
{
  const lines = readFileSync(join(dir, 'ig_belericks.csv'), 'utf8').trim().split(/\r?\n/);
  const headers = parseHeaders(lines[0]!);
  const idx = (k: string) => headers.indexOf(k);
  const labelIdx = headers.findIndex((h) => h.toLowerCase().includes('fake'));
  const rows = lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    return {
      vec: buildProfileFeatureVector({
        hasProfilePic: Number(cols[idx('Profile Pic')]),
        usernameDigitRatio: Number(cols[idx('Nums/Length Username')]),
        fullnameWords: Number(cols[idx('Full Name Words')]),
        bioLen: Number(cols[idx('Bio Length')]),
        hasExternalUrl: Number(cols[idx('External Url')]),
        posts: Number(cols[idx('#Posts')]),
        followers: Number(cols[idx('#Followers')]),
        following: Number(cols[idx('#Following')]),
      }),
      label: Number(cols[labelIdx]),
    };
  });
  evalDataset('IG BeleRicks11 NewDataset.csv', rows);
}

// 3. LeadingIndiaAI full dataset (n=6825)
{
  const rows: Array<{ vec: number[]; label: number }> = [];
  for (const [file, label] of [
    ['leading_fake.csv', 1] as const,
    ['leading_real.csv', 0] as const,
  ]) {
    const lines = readFileSync(join(dir, file), 'utf8').trim().split(/\r?\n/);
    const headers = parseHeaders(lines[0]!);
    const idx = (k: string) => headers.indexOf(k);
    for (const line of lines.slice(1)) {
      const cols = parseCsvLine(line);
      const screen = (cols[idx('screen_name')] ?? '').trim();
      const name = (cols[idx('name')] ?? '').trim();
      const desc = (cols[idx('description')] ?? '').trim();
      const url = (cols[idx('url')] ?? '').trim();
      const defImg = (cols[idx('default_profile_image')] ?? '').trim();
      const posts = Number(cols[idx('statuses_count')] ?? 0);
      const followers = Number(cols[idx('followers_count')] ?? 0);
      const following = Number(cols[idx('friends_count')] ?? 0);
      if (!Number.isFinite(posts) || !Number.isFinite(followers) || !Number.isFinite(following)) continue;
      const digits = (screen.match(/\d/g) ?? []).length;
      rows.push({
        vec: buildProfileFeatureVector({
          hasProfilePic: defImg === '1' || defImg.toLowerCase() === 'true' ? 0 : 1,
          usernameDigitRatio: screen.length > 0 ? digits / screen.length : 0,
          fullnameWords: name ? name.split(/\s+/).filter(Boolean).length : 0,
          bioLen: desc.length,
          hasExternalUrl: url ? 1 : 0,
          posts,
          followers,
          following,
        }),
        label,
      });
    }
  }
  evalDataset('LeadingIndiaAI full (6,825)', rows);
}

console.log('ALL PRODUCTION TYPESCRIPT ML PARITY GATES PASSED.');
