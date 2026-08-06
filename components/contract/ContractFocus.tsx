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
// HISTORY, because it explains the scroll. This was written for a page of
// COLLAPSIBLE <ContractSection> blocks — a component that no longer exists anywhere
// in the codebase — where scrolling a newly-expanded block into view was the whole
// point. The design is now a fixed-height tab inspector that does not move on the
// page, so the scroll is at best a nudge and was actively wrong when it used
// `block: 'center'`: centring a 28rem panel on a phone pushed the action card, which
// holds the button just pressed, off the top of the screen.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/** How long a focused section keeps its highlight ring, in ms. */
const HIGHLIGHT_MS = 2000;

interface ContractFocusValue {
  /** The section currently highlighted, or `null`. */
  focusedId: string | null;
  /** Expand, scroll to, and briefly highlight a section. */
  focusSection: (sectionId: string) => void;
}

const ContractFocusContext = createContext<ContractFocusValue>({
  focusedId: null,
  focusSection: () => {},
});

/** Provides focus coordination to every section in one contract room. */
export function ContractFocusProvider({ children }: { children: ReactNode }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focusSection = useCallback((sectionId: string) => {
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
  }, []);

  const value = useMemo(
    () => ({ focusedId, focusSection }),
    [focusedId, focusSection],
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
export function useContractFocus(): ContractFocusValue {
  return useContext(ContractFocusContext);
}
