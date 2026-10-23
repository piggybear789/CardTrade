// tests/component/referenceGraph.test.tsx
//
// The Trust Network, driven the way a keyboard or screen-reader user drives it:
// select someone, read the card about them, and open their page (the graph walks
// into their network, from /api/references/graph, while the page loads). The orbit
// drawing sits on top of these paths, so they have to work on their own.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferenceGraph } from '@/components/references/ReferenceGraph';
import { ReferenceProfile } from '@/components/references/ReferenceProfile';
import type { ReferenceGraphData, ReferenceGraphNode } from '@/lib/references/graph';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
// Publishing is a server action; these paths only need the composer on screen.
vi.mock('@/lib/actions/references', () => ({ giveReference: vi.fn(), attachReferenceProof: vi.fn() }));
vi.mock('@/lib/storage/uploadReferenceImage', () => ({ uploadReferenceImage: vi.fn() }));

function node(
  profileId: string,
  handle: string,
  kind: ReferenceGraphNode['kind'],
  extra: Partial<ReferenceGraphNode> = {},
): ReferenceGraphNode {
  return {
    id: `${profileId}:POSITIVE`,
    profileId,
    handle,
    handleSlug: handle.slice(1),
    name: handle.slice(1),
    initials: handle.slice(1, 3).toUpperCase(),
    avatarPath: null,
    identityVerified: true,
    firstName: null,
    refs: 10,
    platform: 'instagram',
    platformLabel: 'Instagram',
    platformShort: 'IG',
    platforms: ['instagram'],
    kind,
    sentiment: 'POSITIVE',
    categoryLabel: null,
    comment: null,
    role: 'BOUGHT',
    roleLabel: 'Bought from them',
    roleShortLabel: 'Bought',
    dateLabel: 'Sep 2026',
    deals: 1,
    children: [],
    ...extra,
  };
}

function graphFor(
  profileId: string,
  handle: string,
  nodes: ReferenceGraphNode[],
  links: [string, string][] = [],
): ReferenceGraphData {
  return {
    centre: {
      kind: 'profile',
      id: profileId,
      profileId,
      claimId: null,
      handle,
      handleSlug: handle.slice(1),
      name: handle.slice(1),
      firstName: null,
      identityVerified: true,
      isTrustedSeller: false,
      regionCode: null,
      avatarPath: null,
      memberSince: null,
      unclaimed: false,
      referenceCount: nodes.length,
      peopleCount: nodes.length,
      negativeCount: 0,
      checkedCount: 0,
      platforms: [],
      linkedHandles: [],
    },
    nodes,
    links,
    hidden: { people: 0, issues: 0 },
  };
}

const ROOT = graphFor(
  'pb',
  '@piggybear789',
  [
    node('kai', '@kai.collects', 'escrow', {
      refs: 41,
      comment: 'Always sleeved and top-loaded.',
      children: [{ profileId: 'v1', handle: '@binderboss', handleSlug: 'binderboss', initials: 'BI', refs: 7 }],
    }),
    node('gems', '@graded.gems', 'receipt', { refs: 34 }),
  ],
  [['gems', 'kai']],
);

const KAI = graphFor('kai', '@kai.collects', [node('pb', '@piggybear789', 'escrow'), node('v1', '@binderboss', 'vouch')]);

const KAI_NODE = '@kai.collects, 41 references';
const IN_KAIS_NETWORK = '@binderboss, 10 references';

const setupMatchMedia = window.matchMedia;

beforeEach(() => {
  // Reduced motion: scenes swap without animating, so no assertion races a frame.
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => KAI }) as unknown as Response),
  );
});

afterEach(() => {
  window.matchMedia = setupMatchMedia;
  vi.unstubAllGlobals();
  router.push.mockClear();
});

describe('ReferenceGraph', () => {
  it('opens a card for whoever is selected: the person and their review, no avatar rows', () => {
    render(<ReferenceGraph data={ROOT} />);
    expect(screen.queryByRole('region', { name: 'About @kai.collects' })).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('button', { name: KAI_NODE }), { key: 'Enter' });

    expect(screen.getByRole('button', { name: KAI_NODE })).toHaveAttribute('aria-pressed', 'true');
    const card = screen.getByRole('region', { name: 'About @kai.collects' });
    expect(within(card).getByText('Always sleeved and top-loaded.')).toBeInTheDocument();
    // The "Also reviewed" and "Reviewed by" avatar rows are gone; the drawing shows both.
    expect(within(card).queryByRole('button', { name: '@binderboss' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '@graded.gems' })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Open their network' })).toBeInTheDocument();
  });

  it('closes the card', () => {
    render(<ReferenceGraph data={ROOT} />);
    fireEvent.keyDown(screen.getByRole('button', { name: KAI_NODE }), { key: 'Enter' });

    const card = screen.getByRole('region', { name: 'About @kai.collects' });
    fireEvent.click(within(card).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: /^About / })).not.toBeInTheDocument();
  });

  it('opens someone’s page, walking the graph into their network while it loads', async () => {
    render(<ReferenceGraph data={ROOT} />);
    fireEvent.keyDown(screen.getByRole('button', { name: KAI_NODE }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Open their network' }));

    expect(router.push).toHaveBeenCalledWith('/references/kai.collects', { scroll: true });
    expect(await screen.findByRole('button', { name: IN_KAIS_NETWORK })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/references/graph?handle=kai.collects');
  });

  it('opens someone activated twice from the keyboard, as a double-click would', async () => {
    render(<ReferenceGraph data={ROOT} />);
    fireEvent.keyDown(screen.getByRole('button', { name: KAI_NODE }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: KAI_NODE }), { key: 'Enter' });

    expect(await screen.findByRole('button', { name: IN_KAIS_NETWORK })).toBeInTheDocument();
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('hides this page’s share action once the graph shows someone else', async () => {
    render(<ReferenceGraph data={ROOT} action={<button type="button">Share an experience</button>} />);
    expect(screen.getByRole('button', { name: 'Share an experience' })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('button', { name: KAI_NODE }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Open their network' }));
    await screen.findByRole('button', { name: IN_KAIS_NETWORK });

    expect(screen.queryByRole('button', { name: 'Share an experience' })).not.toBeInTheDocument();
  });
});

describe('ReferenceProfile', () => {
  it('heads the page with who they are and their network with how well vouched for', () => {
    render(<ReferenceProfile data={ROOT} viewer={{ id: 'pb', identityVerified: true }} autoOpen={false} />);

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('heading', { level: 1, name: '@piggybear789' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Share reference link' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Storefront' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /QR/ })).not.toBeInTheDocument();

    const network = screen.getByRole('region', { name: /^References$/ });
    expect(within(network).getByLabelText('2 positive references')).toBeInTheDocument();
  });

  it('opens a two-step modal to leave a reference (the deal, then 1..5 stars + description + image)', () => {
    render(<ReferenceProfile data={ROOT} viewer={{ id: 'v9', identityVerified: true }} autoOpen={false} />);

    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Leave a reference' }));
    const dialog = screen.getByRole('dialog', { name: 'Reference @piggybear789' });

    // Step 1 asks where the deal happened, and will not move on without it.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Select which platform');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Instagram/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));

    expect(within(dialog).getByRole('radio', { name: '5 stars' })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByRole('radio', { name: '1 star' })).toHaveAttribute('aria-checked', 'false');
    expect(within(dialog).getByRole('textbox', { name: 'Description' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Add image' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Publish reference' })).toBeEnabled();
  });

  it('asks a visitor to sign in inside the reference modal', () => {
    render(<ReferenceProfile data={ROOT} viewer={{ id: null, identityVerified: false }} autoOpen={true} />);
    const dialog = screen.getByRole('dialog', { name: 'Reference @piggybear789' });
    // A guest drafts through both steps; sign-in is the last step's action.
    fireEvent.click(within(dialog).getByRole('radio', { name: /Instagram/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByRole('link', { name: 'Sign in to publish' })).toBeInTheDocument();
  });

  it('keeps the page where it is when opening someone, since their page is laid out the same', async () => {
    render(<ReferenceProfile data={ROOT} viewer={{ id: null, identityVerified: false }} autoOpen={false} />);
    fireEvent.keyDown(screen.getByRole('button', { name: KAI_NODE }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Open their network' }));

    expect(router.push).toHaveBeenCalledWith('/references/kai.collects', { scroll: false });
    expect(await screen.findByRole('heading', { level: 1, name: '@kai.collects' })).toBeInTheDocument();
  });
});
