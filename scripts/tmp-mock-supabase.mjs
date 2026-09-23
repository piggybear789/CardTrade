// Local-only PostgREST stand-in for the catalog lab. Serves a fixed set of
// listings whose covers are real card scans on images.pokemontcg.io. Nothing
// here writes anywhere. Delete with the rest of the tmp- scripts.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 54399);
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS || 20);

const NAMED = {
  2: 'Blastoise',
  4: 'Charizard',
  15: 'Venusaur',
  58: 'Pikachu',
  10: 'Mewtwo',
  16: 'Zapdos',
};
const CONDITIONS = ['Mint', 'Near Mint', 'Lightly Played', 'Graded', 'Unopened'];
const GAMES = ['Pokémon', 'Pokémon', 'Pokémon', 'One Piece', 'Yu-Gi-Oh!', 'Magic: The Gathering'];

const sellers = Array.from({ length: 12 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  display_name: `Seller ${index + 1}`,
  rating: 4 + (index % 10) / 10,
  rating_count: 3 + index * 2,
  is_verified: true,
  identity_first_name: `Seller${index + 1}`,
  avatar_path: null,
}));

function hash(n) {
  const x = Math.imul(n, 2654435761) >>> 0;
  return (x ^ (x >>> 13)) >>> 0;
}

const items = [];
let seq = 0;
for (const [set, count, label] of [
  ['base1', 102, 'Base Set'],
  ['sv3pt5', 60, '151'],
]) {
  for (let number = 1; number <= count; number += 1) {
    seq += 1;
    const h = hash(seq);
    const name = set === 'base1' && NAMED[number] ? NAMED[number] : `${label} card`;
    items.push({
      id: `11111111-1111-4111-8111-${String(seq).padStart(12, '0')}`,
      owner_id: sellers[h % sellers.length].id,
      title: `${name} ${number}/${count} — ${label}`,
      category: GAMES[h % GAMES.length],
      condition: CONDITIONS[h % CONDITIONS.length],
      image_paths: [`https://images.pokemontcg.io/${set}/${number}_hires.png`],
      image_dims: [{ w: 734, h: 1024 }],
      fmv_cents: 500 + (h % 400_000),
      watch_count: h % 7,
      listing_kind: 'SINGLE',
      status: 'AVAILABLE',
      hidden: false,
      closed_at: null,
      location_country_code: 'AU',
      seller_rating: sellers[h % sellers.length].rating,
      currency: 'aud',
      created_at: new Date(Date.UTC(2026, 8, 1) - seq * 3_600_000).toISOString(),
    });
  }
}

const tables = { items, public_profiles: sellers };

function parseList(raw) {
  const inner = raw.replace(/^\(/, '').replace(/\)$/, '');
  const out = [];
  let current = '';
  let quoted = false;
  for (const char of inner) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current !== '') out.push(current);
  return out;
}

function coerce(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  return value;
}

function matches(row, column, expr) {
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const arg = expr.slice(dot + 1);
  const value = row[column];
  switch (op) {
    case 'eq':
      return String(value) === String(coerce(arg)) || value === coerce(arg);
    case 'is':
      return value === coerce(arg);
    case 'in':
      return parseList(arg).includes(String(value));
    case 'gte':
      return Number(value) >= Number(arg);
    case 'lte':
      return Number(value) <= Number(arg);
    case 'ilike': {
      const needle = arg.replace(/^[%*]/, '').replace(/[%*]$/, '').replace(/\\(.)/g, '$1');
      return String(value ?? '').toLowerCase().includes(needle.toLowerCase());
    }
    default:
      if (op.startsWith('wfts') || op.startsWith('fts') || op.startsWith('plfts')) {
        const words = arg.toLowerCase().split(/\s+/).filter(Boolean);
        const title = String(row.title).toLowerCase();
        return words.every((word) => title.includes(word));
      }
      return true;
  }
}

function applyOrder(rows, order) {
  if (!order) return rows;
  const keys = order.split(',').map((part) => {
    const [column, direction] = part.split('.');
    return { column, desc: direction === 'desc' };
  });
  return rows.toSorted((a, b) => {
    for (const { column, desc } of keys) {
      const av = a[column];
      const bv = b[column];
      if (av === bv) continue;
      const cmp = av > bv ? 1 : -1;
      return desc ? -cmp : cmp;
    }
    return 0;
  });
}

const RESERVED = new Set(['select', 'order', 'offset', 'limit', 'or', 'search_tsv']);

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const match = url.pathname.match(/^\/rest\/v1\/([a-z_]+)/);
  setTimeout(() => {
    if (!match) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"message":"mock: not found"}');
      return;
    }
    const table = tables[match[1]] ?? [];
    let rows = table;
    for (const [column, expr] of url.searchParams) {
      if (column === 'search_tsv') {
        rows = rows.filter((row) => matches(row, column, expr));
        continue;
      }
      if (RESERVED.has(column)) continue;
      rows = rows.filter((row) => matches(row, column, expr));
    }
    rows = applyOrder(rows, url.searchParams.get('order'));
    const total = rows.length;
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : total;
    const select = (url.searchParams.get('select') || '*').split(',').map((c) => c.trim());
    const page = rows.slice(offset, offset + limit).map((row) => {
      if (select.includes('*')) return row;
      return Object.fromEntries(select.filter((c) => c in row).map((c) => [c, row[c]]));
    });
    const headers = { 'content-type': 'application/json; charset=utf-8' };
    if (String(req.headers.prefer || '').includes('count=exact')) {
      headers['content-range'] = page.length
        ? `${offset}-${offset + page.length - 1}/${total}`
        : `*/${total}`;
    }
    const accept = String(req.headers.accept || '');
    if (accept.includes('vnd.pgrst.object')) {
      res.writeHead(page.length ? 200 : 406, headers);
      res.end(JSON.stringify(page[0] ?? { message: 'mock: no row' }));
      return;
    }
    res.writeHead(200, headers);
    res.end(JSON.stringify(page));
  }, LATENCY_MS);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock supabase ready on ${PORT} with ${items.length} listings`);
});
