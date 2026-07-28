'use client';

// components/contract/ContractFocus.tsx
//
// Wires the action plan to the sections it points at. A step whose action is
// `{ kind: 'focus', target: 'contract-terms' }` calls `focusSection('contract-terms')`,
// and the matching <ContractSection id="contract-terms"> expands itself, scrolls
// into view and pulses a ring so the eye lands on it.
//
// This is what makes a compact, mostly-collapsed contract room navigable: the plan
// drives disclosure, so the reader never has to hunt for the control a step is
// talking about.

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

    // The section may still be collapsed when this fires; it opens on the same
    // render that reads `focusedId`, so scroll on the next frame.
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        const target = document.getElementById(sectionId);
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
