// tests/component/referenceGraph.test.tsx
//
// The Trust Network, driven the way a keyboard or screen-reader user drives it:
// select someone, read the details panel, centre the graph on them (their network
// comes from /api/references/graph) and come back. The orbit drawing sits on top
// of these paths, so they have to work on their own.

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferenceGraph } from '@/components/references/ReferenceGraph';
import type { ReferenceGraphData, ReferenceGraphNode } from '@/lib/references/graph';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
    hidden: { escrow: 0, receipt: 0, vouch: 0, issue: 0 },
  };
}

const ROOT = graphFor(
  'pb',
  '@piggybear789',
  [
    node('kai', '@kai.collects', 'escrow', {
      refs: 41,
      comment: 'Always sleeved and top-loaded.',
      children: [{ profileId: 'v1', handle: '@binderboss', handleSlug: 'binderboss', initials: 'BI', refs: 7, kind: 'vouch' }],
    }),
    node('gems', '@graded.gems', 'receipt', { refs: 34 }),
  ],
  [['gems', 'kai']],
);

const KAI = graphFor('kai', '@kai.collects', [node('pb', '@piggybear789', 'escrow'), node('v1', '@binderboss', 'vouch')]);

const KAI_NODE = '@kai.collects, NoDitto, 41 references';
const ROOT_SUBTITLE = 'Closest in are deals done through NoDitto, then receipt-checked deals, then vouches.';
const WALKED_SUBTITLE = "@kai.collects's network, opened from @piggybear789.";

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
});

describe('ReferenceGraph', () => {
  it('fills the details panel for whoever is selected, including who else they have dealt with', () => {
    render(<ReferenceGraph data={ROOT} />);
    expect(screen.queryByRole('button', { name: 'Centre on them' })).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('button', { name: KAI_NODE }), { key: 'Enter' });

    expect(screen.getByRole('button', { name: KAI_NODE })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Has also dealt with @graded\.gems\./)).toBeInTheDocument();
    expect(screen.getAllByText('“Always sleeved and top-loaded.”').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Centre on them' })).toBeInTheDocument();
  });

  it('walks to someone’s network and comes back', async () => {
    render(<ReferenceGraph data={ROOT} />);
    fireEvent.keyDown(screen.getByRole('button', { name: KAI_NODE }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Centre on them' }));

    expect(await screen.findByText(WALKED_SUBTITLE)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/references/graph?profile=kai');
    expect(screen.getByRole('button', { name: '@binderboss, Vouched, 10 references' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByText(ROOT_SUBTITLE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('centres on someone activated twice from the keyboard, as a double-click would', async () => {
    render(<ReferenceGraph data={ROOT} />);
    fireEvent.keyDown(screen.getByRole('button', { name: KAI_NODE }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: KAI_NODE }), { key: 'Enter' });

    expect(await screen.findByText(WALKED_SUBTITLE)).toBeInTheDocument();
  });

  it('hides the share action while viewing someone else’s network', async () => {
    render(<ReferenceGraph data={ROOT} action={<button type="button">Share an experience</button>} />);
    expect(screen.getByRole('button', { name: 'Share an experience' })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('button', { name: KAI_NODE }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Centre on them' }));
    await screen.findByText(WALKED_SUBTITLE);

    expect(screen.queryByRole('button', { name: 'Share an experience' })).not.toBeInTheDocument();
  });
});
