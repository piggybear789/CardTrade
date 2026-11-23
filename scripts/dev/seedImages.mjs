// scripts/dev/seedImages.mjs
//
// Give the dev sandbox's seeded listings real photos. Run by `npm run dev:db:reset`
// after the seed, or on its own: `node scripts/dev/seedImages.mjs`.
//
// Each image is downloaded from a free card-scan source (the Pokémon TCG API, which
// production already shows; Scryfall for Magic; YGOPRODeck for Yu-Gi-Oh!) or a
// public-domain file on Wikimedia Commons, uploaded to the public `item-images` bucket under `sandbox/<item id>/`, and
// written to `cardtrade_dev.items` with its pixel size, so tiles get their real shape.
//
// `sandbox/` keeps these out of every member's own prefix (`<profile id>/…`). The
// bucket is shared with production, so the prefix is also how they are told apart.
//
// Every seeded listing is a card or object one of those sources has a scan of, so
// every listing gets a photo. Pick a replacement from them if a seed row changes.
import { DEV_SCHEMA, literal, loadEnv, query } from './lib.mjs';

/** item id -> photos, cover first. `source` is for the record; nothing reads it. */
const PHOTOS = {
  // 1999 Pokémon Base Set Charizard #4. Pokémon TCG API scan (base1-4).
  'aaaaaaa1-0000-0000-0000-000000000001': [
    { url: 'https://images.pokemontcg.io/base1/4_hires.png', source: 'pokemontcg.io base1-4' },
  ],
  // 1909-1911 T206 Ty Cobb (Red Portrait). Public domain.
  'bbbbbbb1-0000-0000-0000-000000000001': [
    { fallbackTitle: 'File:1909-11 T206 Ty Cobb portrait red.jpg', source: 'Commons: 1909-11 T206 Ty Cobb portrait red.jpg' },
    { fallbackTitle: 'File:T206 Cobb Back.png', source: 'Commons: T206 Cobb Back.png' },
  ],
  // 1943 Steel Lincoln Wheat Penny. Public domain.
  'cccccccc-0000-0000-0000-000000000001': [
    { fallbackTitle: 'File:Obverse steel cent.png', source: 'Commons: Obverse steel cent.png' },
    { fallbackTitle: 'File:Reverse steel cent.png', source: 'Commons: Reverse steel cent.png' },
  ],
  // 1918 Inverted Jenny. Public domain.
  'cccccccc-0000-0000-0000-000000000002': [
    { fallbackTitle: 'File:US Airmail inverted Jenny 24c 1918 issue.jpg', source: 'Commons: US Airmail inverted Jenny 24c 1918 issue.jpg' },
  ],
  // 1993 Magic Unlimited Shivan Dragon. Scryfall scan (2ED).
  'aaaaaaa2-0000-0000-0000-000000000002': [
    { scryfall: { name: 'Shivan Dragon', set: '2ed' }, source: 'Scryfall: Shivan Dragon (Unlimited)' },
  ],
  // 2000 Neo Genesis Lugia #9. Pokémon TCG API scan (neo1-9).
  'bbbbbbb2-0000-0000-0000-000000000002': [
    { url: 'https://images.pokemontcg.io/neo1/9_hires.png', source: 'pokemontcg.io neo1-9' },
  ],
  // Blue-Eyes White Dragon. YGOPRODeck scan; their terms ask that it be re-hosted, not hotlinked.
  'dddddddd-0000-0000-0000-000000000001': [
    { url: 'https://images.ygoprodeck.com/images/cards/89631139.jpg', source: 'YGOPRODeck 89631139' },
  ],
  // 1999 Base Set Blastoise #2. Pokémon TCG API scan (base1-2).
  'eeeeeeee-0000-0000-0000-000000000001': [
    { url: 'https://images.pokemontcg.io/base1/2_hires.png', source: 'pokemontcg.io base1-2' },
  ],
  // Dark Magician. YGOPRODeck scan.
  'eeeeeeee-0000-0000-0000-000000000002': [
    { url: 'https://images.ygoprodeck.com/images/cards/46986414.jpg', source: 'YGOPRODeck 46986414' },
  ],
  // 1928 Babe Ruth Signed Baseball. Public domain.
  'dddddddd-0000-0000-0000-000000000002': [
    { fallbackTitle: 'File:May 2017- Bullpen-Babe Ruth Baseballs (34550046331).jpg', source: 'Commons: Babe Ruth baseballs (Flickr, public domain)' },
  ],
};

// Wikimedia's policy wants a descriptive agent with a contact; generic agents get 429s.
const UA = { 'User-Agent': 'NoDittoDevSeed/1.0 (https://noditto.app; dev sandbox test data) node-fetch' };

/** Resolve a Commons file title to a 1280px rendition (a standard thumbnail width, served from cache) URL. */
async function commonsUrl(title) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  for (const [k, v] of Object.entries({ action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '1280', format: 'json' })) {
    u.searchParams.set(k, v);
  }
  const json = await (await fetch(u, { headers: UA })).json();
  const info = Object.values(json.query?.pages ?? {})[0]?.imageinfo?.[0];
  if (!info) throw new Error(`Commons has no file ${title}`);
  return info.thumburl ?? info.url;
}

/** Width and height from a PNG or JPEG header. */
function dimensions(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1];
      const length = bytes.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { w: bytes.readUInt16BE(i + 7), h: bytes.readUInt16BE(i + 5) };
      }
      i += 2 + length;
    }
  }
  return null;
}

async function download(photo) {
  // Wikimedia answers 429 to bursts; wait as told (or a few seconds) and try again.
  const tryUrl = async (url) => {
    let res;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      res = await fetch(url, { headers: UA });
      if (res.status !== 429) break;
      const wait = Math.min(Number(res.headers.get('retry-after')) || 5 * (attempt + 1), 20);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? '' };
  };
  if (photo.scryfall) {
    // Scryfall image URLs carry a cache-busting hash, so resolve them from the API.
    const u = new URL('https://api.scryfall.com/cards/named');
    u.searchParams.set('exact', photo.scryfall.name);
    u.searchParams.set('set', photo.scryfall.set);
    const card = await (await fetch(u, { headers: { ...UA, Accept: 'application/json' } })).json();
    if (!card.image_uris?.png) throw new Error(`Scryfall has no image for ${photo.scryfall.name}`);
    return tryUrl(card.image_uris.png);
  }
  try {
    if (photo.url) return await tryUrl(photo.url);
  } catch (error) {
    if (!photo.fallbackTitle) throw error;
  }
  return tryUrl(await commonsUrl(photo.fallbackTitle));
}

export async function seedImages(env = loadEnv()) {
  const base = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing from .env.local');

  for (const [itemId, photos] of Object.entries(PHOTOS)) {
    const paths = [];
    const dims = [];
    for (const [index, photo] of photos.entries()) {
      const { bytes, type } = await download(photo);
      const ext = type.includes('png') || bytes[0] === 0x89 ? 'png' : 'jpg';
      const path = `sandbox/${itemId}/${index}.${ext}`;
      const res = await fetch(`${base}/storage/v1/object/item-images/${path}`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': ext === 'png' ? 'image/png' : 'image/jpeg',
          'x-upsert': 'true',
          'cache-control': '3600',
        },
        body: bytes,
      });
      if (!res.ok) throw new Error(`upload ${path}: ${res.status} ${await res.text()}`);
      paths.push(path);
      dims.push(dimensions(bytes));
    }
    await query(
      env,
      `update ${DEV_SCHEMA}.items
          set image_paths = array[${paths.map(literal).join(', ')}]::text[],
              image_dims = ${literal(JSON.stringify(dims))}::jsonb
        where id = ${literal(itemId)};`,
    );
    console.log(`  ${itemId}: ${paths.length} photo(s) ${dims.map((d) => (d ? `${d.w}x${d.h}` : '?')).join(', ')}`);
  }
}

// Run directly (not when imported by resetDevSchema.mjs).
if (process.argv[1]?.endsWith('seedImages.mjs')) {
  console.log('Uploading sandbox listing photos…');
  await seedImages();
}
