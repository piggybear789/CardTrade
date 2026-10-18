// tests/e2e/debug/canvas-proposals.spec.ts
//
// Exploration only. Captures every reviewed surface at 1440x900, then for the
// surfaces with a proposal applies that proposal in the browser (inline styles and
// small DOM edits, never app code) and captures again. Writes compact WebP data URIs
// for the review canvas to `ux-review/captures/canvas-proposals/proposal-thumbs.json`.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import type { BrowserContext, Page } from '@playwright/test';

import { test } from '../support/fixtures';
import { ensureFreshSessions } from '../support/auth';
import { marked, markedEmail } from '../support/marker';
import {
  ALICE,
  BOB,
  FRANK_ADMIN,
  GRACE_SUPPORT,
  storageStatePath,
} from '../support/users';

// `CURRENT_ONLY=1` captures the app as it is, without proposals, into its own folder.
const CURRENT_ONLY = process.env.CURRENT_ONLY === '1';
const OUT_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'ux-review',
  'captures',
  CURRENT_ONLY ? 'canvas-implemented' : 'canvas-proposals',
);
const THUMBS_JSON = path.join(OUT_DIR, 'proposal-thumbs.json');
const VIEW = { width: 1440, height: 900 };

function loadEnvLocal(): Record<string, string> {
  const raw = readFileSync(path.resolve(__dirname, '..', '..', '..', '.env.local'), 'utf8');
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const ENV = loadEnvLocal();
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? ENV.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ENV.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function restInsert<T = Record<string, unknown>>(table: string, body: unknown): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Accept-Profile': 'cardtrade',
      'Content-Profile': 'cardtrade',
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${table} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as T[];
}

interface SeededIds {
  aliceItemId: string;
  cashSaleId: string;
  tradeId: string;
  conversationId: string;
  inviteToken: string;
}

async function seedAuditRows(): Promise<SeededIds> {
  const imgA = '216cdd7d-ef4a-466d-bffe-6a55f64d4dc1/2011fde7-6a03-4ba5-bd2a-56ee19458598/0.jpg';
  const imgB = '27cf7959-22ec-438d-9521-0cc8dc53c706/884b7935-d87c-43dd-a473-10618e8bf399/0.webp';
  const base = {
    category: 'Pokémon',
    condition: 'Near Mint',
    listing_kind: 'SINGLE',
    hidden: false,
    location_country_code: 'AU',
  };

  const [aliceItem] = await restInsert<{ id: string }>('items', {
    ...base,
    owner_id: ALICE.id,
    title: marked('1999 Base Set Charizard #4 PSA 8'),
    description: 'Clean holo surface, sharp corners, stored in a graded sleeve.',
    fmv_cents: 45000,
    status: 'AVAILABLE',
    location_label: 'Sydney NSW, Australia',
    image_paths: [imgA, imgB],
  });
  const [aliceSaleItem] = await restInsert<{ id: string }>('items', {
    ...base,
    owner_id: ALICE.id,
    title: marked('Umbreon Neo Discovery 1st Ed PSA 9'),
    description: 'First edition holo with swirl, graded PSA 9 Mint.',
    fmv_cents: 68000,
    status: 'RESERVED',
    location_label: 'Sydney NSW, Australia',
    image_paths: [imgB],
  });
  const [bobItem] = await restInsert<{ id: string }>('items', {
    ...base,
    category: 'Sports Cards',
    owner_id: BOB.id,
    title: marked('1986 Fleer Michael Jordan #57 BGS 8'),
    description: 'Centering 65/35, strong corners and deep gloss.',
    fmv_cents: 52000,
    status: 'AVAILABLE',
    location_label: 'Melbourne VIC, Australia',
    image_paths: [imgA],
  });

  const [conv] = await restInsert<{ id: string }>('conversations', {
    item_id: aliceItem.id,
    participant_a: ALICE.id,
    participant_b: BOB.id,
  });
  await restInsert('messages', [
    { conversation_id: conv.id, sender_id: BOB.id, kind: 'USER', body: marked('Hey Alice — is the holo surface clean under angled light?') },
    { conversation_id: conv.id, sender_id: ALICE.id, kind: 'USER', body: marked('Yes, happy to send close-ups or agree tracked express post today.') },
  ]);
  await restInsert('offers', {
    item_id: aliceItem.id,
    seller_id: ALICE.id,
    buyer_id: BOB.id,
    offered_by: BOB.id,
    amount_cents: 41000,
    status: 'PENDING',
    message: marked('Can do $410 with tracked express shipping today.'),
  });

  const [saleConv] = await restInsert<{ id: string }>('conversations', {
    item_id: aliceSaleItem.id,
    participant_a: ALICE.id,
    participant_b: BOB.id,
  });
  const [sale] = await restInsert<{ id: string }>('cash_sales', {
    item_id: aliceSaleItem.id,
    seller_id: ALICE.id,
    buyer_id: BOB.id,
    amount_cents: 69500,
    agreed_price_cents: 68000,
    platform_fee_cents: 0,
    status: 'AGREEMENT',
    item_title: marked('Umbreon Neo Discovery 1st Ed PSA 9'),
    item_description: 'First edition holo with swirl, graded PSA 9 Mint.',
    item_condition: 'Near Mint',
    item_image_paths: [imgB],
    fulfillment_method: 'DELIVERY',
    shipping_cost_cents: 1500,
    conversation_id: saleConv.id,
  });

  const [tradeConv] = await restInsert<{ id: string }>('conversations', {
    participant_a: ALICE.id,
    participant_b: BOB.id,
  });
  const [trade] = await restInsert<{ id: string }>('trades', {
    initiator_id: ALICE.id,
    counterpart_id: BOB.id,
    initiator_item_id: aliceItem.id,
    counterpart_item_id: bobItem.id,
    state: 'NEGOTIATING',
    cash_amount_cents: 5000,
    cash_direction: 'PROPOSER_PAYS',
    handover_method: 'DELIVERY',
    delivery_cost_cents: 1500,
    offer_message: marked('Happy to add $50 cash boot with tracked post both ways.'),
    conversation_id: tradeConv.id,
  });
  await restInsert('trade_items', [
    { trade_id: trade.id, trader_id: ALICE.id, item_id: aliceItem.id },
    { trade_id: trade.id, trader_id: BOB.id, item_id: bobItem.id },
  ]);

  return {
    aliceItemId: aliceItem.id,
    cashSaleId: sale.id,
    tradeId: trade.id,
    conversationId: conv.id,
    inviteToken: 'bg9bkC63w25ISJjF1Vhw145A',
  };
}

// Page-side helpers, installed on every document. Deepest-match text lookups so a
// proposal can target "the badge that says X" without knowing the component tree.
const HELPERS = `
(() => {
  const hideDevOverlay = () => {
    if (document.getElementById('__proposal_style')) return;
    const s = document.createElement('style');
    s.id = '__proposal_style';
    s.textContent = 'nextjs-portal{display:none!important}';
    (document.head || document.documentElement).appendChild(s);
  };
  document.addEventListener('DOMContentLoaded', hideDevOverlay);
  window.__h = {
    all(sel = '*', root = document) { return Array.from((root || document).querySelectorAll(sel)); },
    deepest(els) { return els.filter((el) => !els.some((o) => o !== el && el.contains(o))); },
    exact(text, sel = '*', root = document) {
      return this.deepest(this.all(sel, root).filter((el) => (el.textContent || '').trim() === text));
    },
    starts(text, sel = '*', root = document) {
      return this.deepest(this.all(sel, root).filter((el) => (el.textContent || '').trim().startsWith(text)));
    },
    match(re, sel = '*', root = document) {
      return this.deepest(this.all(sel, root).filter((el) => re.test((el.textContent || '').trim())));
    },
    up(el, pred) {
      let n = el;
      while (n && n !== document.body) { if (pred(n)) return n; n = n.parentElement; }
      return null;
    },
    bordered(el) {
      const cs = getComputedStyle(el);
      return parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
    },
    filled(el) {
      const bg = getComputedStyle(el).backgroundColor;
      return !!bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    },
    // Screen-reader-only copies have a 1px box, so they need a real size to count.
    visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden';
    },
    css(el, styles) { if (el) Object.assign(el.style, styles); return el ? 1 : 0; },
    hide(el) { if (el) el.style.setProperty('display', 'none', 'important'); return el ? 1 : 0; },
  };
})();
`;

type Proposal = (page: Page) => Promise<number>;

/* eslint-disable @typescript-eslint/no-explicit-any */
const PROPOSALS: Record<string, Proposal> = {
  'home-catalog': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      const [title] = h.exact('Buy, sell and trade cards with verified collectors');
      const strip = title && h.up(title, (el: Element) => h.bordered(el));
      if (!strip) return 0;
      h.css(strip, { background: 'hsl(var(--primary) / 0.07)', borderColor: 'transparent' });
      strip.querySelectorAll('svg').forEach((s: SVGElement) => { s.style.color = 'hsl(var(--primary))'; });
      return 1;
    }),

  'seller-profile': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      const [name] = h.exact('Alice Nguyen', 'h1, h2, h3');
      const head = name && h.up(name, (el: Element) => (el.textContent || '').includes('Member since') && (el.textContent || '').includes('Sign in to message'));
      if (head) {
        n += h.css(head, { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', padding: '20px 24px' });
        const [initials] = h.exact('AN', '*', head);
        const ring = initials && h.up(initials, (el: Element) => /9999|50%/.test(getComputedStyle(el).borderTopLeftRadius));
        if (ring) {
          n += h.css(ring, { width: '56px', height: '56px', fontSize: '18px' });
          if (initials !== ring) h.css(initials, { width: '100%', height: '100%', display: 'grid', placeItems: 'center' });
        }
      }
      const [cta] = h.exact('Sign in to message', 'a, button');
      n += h.css(cta, { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))', borderColor: 'transparent' });
      return n;
    }),

  'listing-detail': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      const group = h.all('[aria-label="Start a contract"]').find(h.visible) as HTMLElement | undefined;
      if (group) {
        n += h.css(group, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', alignItems: 'stretch' });
        const cells = Array.from(group.children) as HTMLElement[];
        h.css(cells[0], { gridColumn: '1 / -1' });
        Array.from(group.querySelectorAll('button.group')).forEach((btn, i) => {
          const b = btn as HTMLElement;
          h.css(b, { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: '8px', height: '44px', minHeight: '44px', padding: '0 16px', borderRadius: '8px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', width: '100%' });
          const [chip, label] = Array.from(b.children) as HTMLElement[];
          h.css(chip, { width: 'auto', height: 'auto', border: '0', background: 'transparent', borderRadius: '0', color: 'inherit' });
          h.css(label, { width: 'auto', textAlign: 'center' });
          if (i === 0) h.css(b, { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))', borderColor: 'transparent' });
        });
        const seller = h.all('section[aria-labelledby="seller-heading"]').find(h.visible);
        const block = seller && h.up(group, (el: Element) => el.parentElement === seller.parentElement);
        if (seller && block && block !== seller) {
          seller.after(block);
          n += h.css(block, { marginTop: '4px', paddingTop: '0' });
        }
      }
      const note = h.starts('NoDitto is in open beta, so NoDitto fees are waived').find(h.visible);
      if (note) { note.textContent = 'No NoDitto fees during open beta.'; n += 1; }
      return n;
    }),

  'listing-detail-owner': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      const edit = h.exact('Edit listing').find(h.visible);
      const seller = h.all('section[aria-labelledby="seller-heading"]').find(h.visible);
      const block = edit && seller && h.up(edit, (el: Element) => el.parentElement === seller.parentElement);
      if (seller && block) {
        seller.after(block);
        n += h.hide(seller);
        n += h.css(block, { marginTop: '4px', paddingTop: '0' });
        const dl = block.querySelector('dl');
        if (dl && dl.children[0]) n += h.hide(dl.children[0]);
      }
      n += h.hide(h.starts('Open beta: NoDitto fees waived').find(h.visible));
      const del = h.all('button[aria-label="Delete listing"]').find(h.visible);
      n += h.css(del, { color: 'hsl(var(--muted-foreground))', borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' });
      return n;
    }),

  'listings-new': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      const [add] = h.exact('Add photos');
      const zone = add && h.up(add, (el: Element) => h.filled(el) && el.getBoundingClientRect().height > 300);
      n += h.css(zone, { background: 'hsl(var(--card))', border: '2px dashed hsl(var(--border))' });
      if (zone) zone.querySelectorAll('svg').forEach((s: SVGElement) => { s.style.color = 'hsl(var(--primary))'; });
      const [buyers] = h.exact('Buyers see');
      const grid = buyers && h.up(buyers, (el: Element) => /You.ll get/.test(el.textContent || ''));
      n += h.hide(grid);
      return n;
    }),

  'listings-mine': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      const tone = (text: string, bg: string, fg: string) => {
        h.exact(text, 'span, div').forEach((el: HTMLElement) => {
          if (getComputedStyle(el).borderRadius === '0px') return;
          n += h.css(el, { background: bg, color: fg, borderColor: 'transparent' });
          el.querySelectorAll('span').forEach((d) => { (d as HTMLElement).style.background = fg; });
        });
      };
      tone('Live', 'hsl(var(--trust) / 0.12)', 'hsl(var(--trust))');
      tone('Hidden', 'hsl(var(--destructive) / 0.1)', 'hsl(var(--destructive))');
      tone('Under contract', 'hsl(var(--primary) / 0.12)', 'hsl(var(--primary))');
      return n;
    }),

  'deals-compose': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      h.all('body *').forEach((el: HTMLElement) => {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' || el.getAttribute('role') === 'dialog') return;
        const r = el.getBoundingClientRect();
        if (r.width < innerWidth * 0.9 || r.height < innerHeight * 0.9) return;
        n += h.css(el, { background: 'transparent', backdropFilter: 'none' });
      });
      const dlg = document.querySelector('[role="dialog"]');
      h.css(dlg, { boxShadow: 'none', border: '1px solid hsl(var(--border))' });
      return n;
    }),

  'onboarding-wizard': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      h.all('body *').forEach((el: HTMLElement) => {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' || el.getAttribute('role') === 'dialog') return;
        const r = el.getBoundingClientRect();
        if (r.width < innerWidth * 0.9 || r.height < innerHeight * 0.9) return;
        n += h.css(el, { background: 'transparent', backdropFilter: 'none' });
      });
      const dlg = document.querySelector('[role="dialog"]');
      h.css(dlg, { boxShadow: 'none', border: '1px solid hsl(var(--border))' });
      return n;
    }),

  'cash-sale-room': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      // The status tab is the left column; the dock with the same sentence is in the chat column.
      // The card is the highest ancestor that does not also hold the stepper above it.
      const centre = h.exact('Waiting for Bob Carter to pay').find((el: Element) => h.visible(el) && el.getBoundingClientRect().left < innerWidth * 0.55);
      let card: Element | null = centre ?? null;
      while (card && card.parentElement && !(card.parentElement.textContent || '').includes('Discuss terms')) card = card.parentElement;
      n += h.hide(card);
      h.exact('Agreeing terms').forEach((el: HTMLElement) => { el.textContent = 'Awaiting payment'; n += 1; });
      return n;
    }),

  'trade-room': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      h.all('main *').forEach((el: HTMLElement) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs.textOverflow !== 'ellipsis' || r.left > innerWidth * 0.62 || (el.textContent || '').length > 120) return;
        h.css(el, { whiteSpace: 'normal', overflow: 'hidden', textOverflow: 'clip', display: '-webkit-box' });
        el.style.setProperty('-webkit-line-clamp', '2');
        el.style.setProperty('-webkit-box-orient', 'vertical');
        n += 1;
      });
      h.exact('NoDitto fee').forEach((el: Element) => {
        const row = h.up(el, (a: Element) => (a.textContent || '').includes('$0.00'));
        if (row && (row.textContent || '').trim().length < 60) n += h.hide(row);
      });
      h.exact('Holds').forEach((el: HTMLElement) => { el.textContent = 'Agree terms'; n += 1; });
      h.exact('Step 1 of 6 · Holds').forEach((el: HTMLElement) => { el.textContent = 'Step 1 of 6 · Agree terms'; n += 1; });
      return n;
    }),

  'trades-list': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      h.exact('Both traders post collateral').forEach((el: HTMLElement) => { el.textContent = 'Accept the terms'; n += 1; });
      return n;
    }),

  'messages-inbox': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      h.all('[class*="bg-foreground"][class*="rounded-2xl"]').forEach((el: HTMLElement) => {
        n += h.css(el, { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' });
        el.querySelectorAll('[class*="text-background"]').forEach((t) => { (t as HTMLElement).style.color = 'hsl(var(--primary-foreground))'; });
      });
      const previews = ['Trade · Charizard ⇄ Jordan BGS 8', 'Umbreon Neo Discovery 1st Ed PSA 9', 'Charizard Base Set Holo'];
      h.exact('No messages yet').forEach((el: HTMLElement, i: number) => {
        el.textContent = previews[i] ?? previews[previews.length - 1];
        n += 1;
      });
      return n;
    }),

  'notifications-surface': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      h.all('button[class*="bg-accent/40"]').forEach((btn: HTMLElement) => {
        n += h.css(btn, { background: 'hsl(var(--card))' });
        const title = btn.querySelector('[class*="font-semibold"], [class*="font-medium"]');
        if (title && !title.querySelector('.__dot')) {
          const dot = document.createElement('span');
          dot.className = '__dot';
          dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:999px;background:hsl(var(--primary));margin-right:8px;vertical-align:middle';
          title.prepend(dot);
        }
      });
      h.exact('No longer available').forEach((el: HTMLElement) => {
        n += h.css(el, { display: 'inline-block', background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', padding: '1px 8px', borderRadius: '999px', fontSize: '11px', marginTop: '4px', fontWeight: '500' });
      });
      return n;
    }),

  'offers-list': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      const strike = h.all('main *').find((el: Element) => getComputedStyle(el).textDecorationLine.includes('line-through'));
      if (strike) {
        strike.textContent = '9% under your $450.00 ask';
        n += h.css(strike, { textDecoration: 'none', background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', padding: '2px 8px', borderRadius: '999px', fontSize: '12px', marginLeft: '8px', fontWeight: '500' });
      }
      h.match(/^You.d get /).forEach((el: Element) => { n += h.hide(el); });
      return n;
    }),

  'buy-now-dialog': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return 0;
      h.exact('Open beta: NoDitto fees waived (normally 5%)', '*', dlg).forEach((el: Element) => { n += h.hide(el); });
      h.exact('Stripe method', '*', dlg).forEach((el: HTMLElement) => { el.textContent = 'Saved card · charged when you pay in the contract'; n += 1; });
      return n;
    }),

  'make-offer-dialog': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return 0;
      h.exact('Open beta: NoDitto fees waived (normally 5%)', '*', dlg).forEach((el: Element) => { n += h.hide(el); });
      return n;
    }),

  'propose-trade-dialog': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return 0;
      const [send] = h.starts('Send offer', 'button', dlg);
      n += h.css(send, { background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))', borderColor: 'transparent', opacity: '0.45' });
      const [val] = h.starts('Valued at the seller', '*', dlg);
      if (val) { val.textContent = 'Valued at the seller’s asking price.'; n += 1; }
      return n;
    }),

  'not-found': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      const [err] = h.exact('Error 404');
      const box = err && h.up(err, (a: Element) => !!a.querySelector('svg'));
      const svg = box && box.querySelector('svg');
      if (svg && svg.parentElement) n += h.hide(svg.parentElement);
      h.exact('Back to home', 'a').forEach((el: Element) => { n += h.hide(el); });
      const [trust] = h.starts('Every trade on NoDitto');
      const line = trust && h.up(trust, (a: Element) => !!a.querySelector('svg'));
      n += h.hide(line || trust);
      return n;
    }),

  'auth-dead-states': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      const [title] = h.exact('Choose a new password');
      const card = title && h.up(title, (el: Element) => h.bordered(el));
      if (!card) return 0;
      card.innerHTML = `
        <div style="padding:20px;display:flex;flex-direction:column;gap:10px">
          <h1 style="font-size:17px;font-weight:600;color:hsl(var(--foreground))">This reset link has expired</h1>
          <p style="font-size:14px;line-height:1.5;color:hsl(var(--muted-foreground))">Reset links work once and only for a short time. Send yourself a new one to choose a password.</p>
          <a style="margin-top:6px;display:flex;align-items:center;justify-content:center;height:40px;border-radius:8px;background:hsl(var(--primary));color:hsl(var(--primary-foreground));font-weight:600;font-size:14px">Send a new link</a>
          <a style="text-align:center;font-size:13px;color:hsl(var(--muted-foreground));text-decoration:underline">Back to sign in</a>
        </div>`;
      return 1;
    }),

  'deal-invite': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      const [deal] = h.exact('Deal');
      const row = deal && h.up(deal, (a: Element) => (a.textContent || '').includes('Trade') && (a.textContent || '').trim().length < 20);
      n += h.hide(row || deal);
      const [req] = h.starts('Stripe Identity is required for both of you');
      n += h.hide(req);
      return n;
    }),

  'admin-console': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      h.starts('Money held for members').forEach((t: Element) => {
        const card = h.up(t, (el: Element) => h.bordered(el) && h.filled(el));
        n += h.css(card, { background: 'hsl(var(--card))' });
      });
      return n;
    }),

  'arbitration-workspace': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      h.exact('Queue Is Clear').forEach((el: HTMLElement) => { el.textContent = 'Queue is clear'; n += 1; });
      return n;
    }),

  'report-scam': (page) =>
    page.evaluate(() => {
      const h = (window as any).__h;
      let n = 0;
      h.exact('Sign in').forEach((el: HTMLElement) => {
        if (el.closest('a, button, header')) return;
        el.textContent = 'Sign in to report a scam';
        n += 1;
      });
      h.exact('Welcome back. Enter your credentials to continue.').forEach((el: HTMLElement) => {
        el.textContent = 'We ask who is reporting so our case team can follow up with you.';
        n += 1;
      });
      return n;
    }),

};
/* eslint-enable @typescript-eslint/no-explicit-any */

test.use({
  viewport: VIEW,
  colorScheme: 'light',
  navigationTimeout: 30_000,
  actionTimeout: 8_000,
});

test.describe.configure({ mode: 'serial', timeout: 15 * 60_000 });

const thumbs: Record<string, { before?: string; after?: string; applied?: number }> = {};

async function encode(buf: Buffer): Promise<string> {
  const webp = await sharp(buf).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 58 }).toBuffer();
  return `data:image/webp;base64,${webp.toString('base64')}`;
}

async function shot(page: Page, id: string, phase: 'before' | 'after'): Promise<void> {
  await page.waitForTimeout(350);
  const buf = await page.screenshot({
    path: path.join(OUT_DIR, `${id}.${phase}.png`),
    animations: 'disabled',
    caret: 'initial',
  });
  thumbs[id] = { ...thumbs[id], [phase]: await encode(buf) };
  writeFileSync(THUMBS_JSON, JSON.stringify(thumbs));
  console.log(`SNAP ${id}.${phase}`);
}

/** Capture the current page, then its proposal if there is one. */
async function review(page: Page, id: string): Promise<void> {
  await shot(page, id, 'before');
  const proposal = PROPOSALS[id];
  if (!proposal || CURRENT_ONLY) return;
  try {
    const applied = await proposal(page);
    thumbs[id] = { ...thumbs[id], applied };
    console.log(`APPLY ${id}: ${applied}`);
    await shot(page, id, 'after');
  } catch (err) {
    console.log(`ERR ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function visit(page: Page, route: string, id: string): Promise<void> {
  try {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.locator('h1, h2, h3').filter({ visible: true }).first().waitFor({ timeout: 8_000 }).catch(() => undefined);
    // A proposal applied before hydration finishes is thrown away when React rebuilds the tree.
    await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    await review(page, id);
  } catch (err) {
    console.log(`ERR ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function openDialog(page: Page, name: RegExp | string): Promise<boolean> {
  const button = page.getByRole('button', { name }).first();
  if (!(await button.isVisible().catch(() => false))) return false;
  await button.click();
  await page.getByRole('dialog').first().waitFor({ timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(600);
  return true;
}

async function newContext(browser: import('@playwright/test').Browser, storage?: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: VIEW, ...(storage ? { storageState: storage } : {}) });
  await ctx.addInitScript({ content: HELPERS });
  return ctx;
}

test('capture current and proposed screens', async ({ browser }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  execFileSync('npx', ['tsx', '--env-file=.env.local', 'scripts/e2e/cleanup-test-data.ts'], { stdio: 'inherit', shell: true });

  await ensureFreshSessions(browser, [ALICE, BOB, FRANK_ADMIN, GRACE_SUPPORT]);
  const ids = await seedAuditRows();
  const contexts: BrowserContext[] = [];

  try {
    // Guest
    const guest = await newContext(browser);
    contexts.push(guest);
    const g = await guest.newPage();
    await visit(g, '/', 'home-catalog');
    if (await openDialog(g, 'Help').catch(() => false)) {
      await review(g, 'site-header-menus');
      await g.keyboard.press('Escape').catch(() => undefined);
    }
    await visit(g, `/sellers/${ALICE.id}`, 'seller-profile');
    await visit(g, '/sign-in', 'auth-core');
    await visit(g, '/auth/update-password', 'auth-dead-states');
    await visit(g, '/account-suspended', 'account-suspended');
    await visit(g, '/this-route-does-not-exist', 'not-found');
    await visit(g, '/help', 'help-safety');
    await visit(g, '/terms', 'legal-pages');
    await visit(g, '/trusted-sellers', 'trusted-sellers');
    await visit(g, '/report-scam', 'report-scam');
    await visit(g, `/t/${ids.inviteToken}`, 'deal-invite');

    // Alice: seller
    const alice = await newContext(browser, storageStatePath(ALICE));
    contexts.push(alice);
    const a = await alice.newPage();
    await visit(a, `/listings/${ids.aliceItemId}`, 'listing-detail-owner');
    if (await openDialog(a, 'Delete listing')) {
      await review(a, 'delete-close-dialogs');
      await a.keyboard.press('Escape').catch(() => undefined);
    }
    await visit(a, '/listings/new', 'listings-new');
    await visit(a, '/listings/mine', 'listings-mine');
    await visit(a, '/deals', 'deals-compose');
    await visit(a, '/saved', 'saved-watchlist');
    await visit(a, '/offers', 'offers-list');
    await visit(a, '/sales', 'sales-purchases-lists');
    await visit(a, `/sales/${ids.cashSaleId}`, 'cash-sale-room');
    await visit(a, '/trades', 'trades-list');
    await visit(a, `/trades/${ids.tradeId}`, 'trade-room');
    await visit(a, `/messages/${ids.conversationId}`, 'messages-inbox');
    await visit(a, '/notifications', 'notifications-surface');
    await visit(a, '/profile', 'profile-hub');
    await visit(a, '/profile?tab=verification', 'profile-verification');
    await visit(a, '/profile?tab=payouts', 'profile-payouts');
    await visit(a, '/report-scam', 'report-scam-form');

    // Bob: buyer on Alice's listing
    const bob = await newContext(browser, storageStatePath(BOB));
    contexts.push(bob);
    const b = await bob.newPage();
    await visit(b, `/listings/${ids.aliceItemId}`, 'listing-detail');
    for (const [label, id] of [
      [/^Buy( now)?$/i, 'buy-now-dialog'],
      [/Make an offer/i, 'make-offer-dialog'],
      [/Propose (a )?trade/i, 'propose-trade-dialog'],
      ['Report listing', 'report-feedback-dialogs'],
    ] as const) {
      if (await openDialog(b, label)) {
        await review(b, id);
        await b.keyboard.press('Escape').catch(() => undefined);
        await b.waitForTimeout(300);
      }
    }

    // Staff
    const frank = await newContext(browser, storageStatePath(FRANK_ADMIN));
    contexts.push(frank);
    await visit(await frank.newPage(), '/admin', 'admin-console');
    const grace = await newContext(browser, storageStatePath(GRACE_SUPPORT));
    contexts.push(grace);
    await visit(await grace.newPage(), '/admin/arbitration', 'arbitration-workspace');

    // New member
    const fresh = await newContext(browser);
    contexts.push(fresh);
    const f = await fresh.newPage();
    await f.goto('/sign-up', { waitUntil: 'domcontentloaded' });
    await f.getByLabel('Email').fill(markedEmail('canvas-proposals'));
    await f.getByLabel('Password', { exact: true }).fill('TestPassword123!');
    await f.getByRole('checkbox', { name: /accept the Terms/i }).check();
    await f.getByRole('button', { name: 'Create account' }).click();
    await f.waitForURL(/\/onboarding/, { timeout: 25_000 });
    await f.getByRole('dialog').first().waitFor({ timeout: 8_000 }).catch(() => undefined);
    await review(f, 'onboarding-wizard');
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => undefined);
    execFileSync('npx', ['tsx', '--env-file=.env.local', 'scripts/e2e/cleanup-test-data.ts'], { stdio: 'inherit', shell: true });
  }
});
