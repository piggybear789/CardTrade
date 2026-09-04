'use client';

// components/contract/ContractFocus.tsx
//
// Wires the action card to the contract detail it points at. A step whose action is
// `{ kind: 'focus', target: 'contract-terms' }` calls `focusSection('contract-terms')`;
// `ContractDetailList` reads `focusedId`, selects the matching tab, and pulses a ring
// so the eye lands on it.
//
// This is what makes a dense contract room navigable: the action card drives
// disclosure, so the reader never has to hunt for the control a step is talking about.
//
// Below `md` the details live in a sheet rather than a pane, so this also owns
// whether that sheet is open. It is held in the URL (`?details=1`) via the native
// history API, which Next routes through its own router: the phone's back gesture
// closes the sheet instead of leaving the contract, and `pushState` avoids the
// server round trip `router.push` would cost on these `force-dynamic` routes.
//
// HISTORY, because it explains the scroll. This was written for a page of
// COLLAPSIBLE <ContractSection> blocks — a component that no longer exists anywhere
// in the codebase — where scrolling a newly-expanded block into view was the whole
// point. The design is now a fixed-height tab inspector that does not move on the
// page, so the scroll is at best a nudge and was actively wrong when it used
// `block: 'center'`: centring a 28rem panel on a phone pushed the action card, which
// holds the button just pressed, off the top of the screen.

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/** How long a focused section keeps its highlight ring, in ms. */
const HIGHLIGHT_MS = 2000;

/** Search param that holds the details sheet open below `md`. */
const DETAILS_PARAM = 'details';

function detailsInLocation(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(DETAILS_PARAM) === '1';
}

interface ContractFocusState {
  /** The section currently highlighted, or `null`. */
  focusedId: string | null;
  /** Whether the details sheet is open below `md`. */
  detailsOpen: boolean;
}

interface ContractFocusActions {
  /** Expand, scroll to, and briefly highlight a section. */
  focusSection: (sectionId: string) => void;
  openDetails: () => void;
  closeDetails: () => void;
}

interface ContractFocusContextValue {
  state: ContractFocusState;
  actions: ContractFocusActions;
}

const ContractFocusContext = createContext<ContractFocusContextValue>({
  state: { focusedId: null, detailsOpen: false },
  actions: { focusSection: () => {}, openDetails: () => {}, closeDetails: () => {} },
});

/** Provides focus coordination to every section in one contract room. */
export function ContractFocusProvider({ children }: { children: ReactNode }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Server-rendered as closed and reconciled on mount, because the sheet is a
  // portal: opening it during hydration from a `?details=1` deep link would
  // paint an overlay the server never rendered.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // True only while THIS component owns the history entry holding the sheet
  // open. `back()` is right when we pushed that entry; on a deep link there is
  // nothing of ours to pop and going back would leave the room entirely.
  const pushed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `pushState` does not fire `popstate`, so this listener only ever sees the
  // user's own back/forward — which is exactly what has to close the sheet.
  useEffect(() => {
    setDetailsOpen(detailsInLocation());

    function syncFromLocation() {
      const open = detailsInLocation();
      if (!open) pushed.current = false;
      setDetailsOpen(open);
    }

    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, []);

  const openDetails = useCallback(() => {
    setDetailsOpen(true);
    if (detailsInLocation()) return;
    const params = new URLSearchParams(window.location.search);
    params.set(DETAILS_PARAM, '1');
    window.history.pushState(null, '', `${window.location.pathname}?${params}`);
    pushed.current = true;
  }, []);

  const closeDetails = useCallback(() => {
    setDetailsOpen(false);
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
      return;
    }
    if (!detailsInLocation()) return;
    const params = new URLSearchParams(window.location.search);
    params.delete(DETAILS_PARAM);
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      query ? `${window.location.pathname}?${query}` : window.location.pathname,
    );
  }, []);

  const focusSection = useCallback((sectionId: string) => {
    openDetails();
    setFocusedId(sectionId);

    // The target tab may not be selected yet; it is selected on the same render
    // that reads `focusedId`, so scroll on the next frame.
    //
    // `nearest`, not `center`: the panel is usually already on screen and should
    // not be moved at all, and when it is partly off screen the least surprising
    // result is the smallest scroll that reveals it. `nearest` also honours the
    // panel's `scroll-mt`, which `center` ignores — `scroll-margin` applies to
    // start/end/nearest alignment only.
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        const target = document.getElementById(sectionId);
        target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFocusedId(null), HIGHLIGHT_MS);
  }, [openDetails]);

  const value = useMemo(
    () => ({
      state: { focusedId, detailsOpen },
      actions: { focusSection, openDetails, closeDetails },
    }),
    [focusedId, detailsOpen, focusSection, openDetails, closeDetails],
  );

  return (
    <ContractFocusContext.Provider value={value}>
      {children}
    </ContractFocusContext.Provider>
  );
}

/**
 * Read focus state. Safe outside a provider — `focusSection` becomes a no-op, so
 * a section can be rendered standalone.
 */
export function useContractFocus() {
  const { state, actions } = use(ContractFocusContext);
  return {
    focusedId: state.focusedId,
    detailsOpen: state.detailsOpen,
    focusSection: actions.focusSection,
    openDetails: actions.openDetails,
    closeDetails: actions.closeDetails,
  };
}
