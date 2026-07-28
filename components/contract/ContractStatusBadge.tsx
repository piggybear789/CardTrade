// components/contract/ContractStatusBadge.tsx
//
// One badge for the current status of any contract. Each flow keeps ownership of
// its own state enum by declaring a `ContractStatusMap`, then renders it through
// this component — so `Trade_State`, `deal_state` and `cash_sales.status` all get
// identical typography, tone vocabulary and accessible labelling.

import { Badge } from '@/components/ui/badge';
import type { ContractStatusTone } from './types';

/** Label + badge tone for one status value. */
export interface ContractStatusMeta {
  label: string;
  tone: ContractStatusTone;
}

/** An exhaustive status -> presentation map for one contract flow. */
export type ContractStatusMap<S extends string> = Record<S, ContractStatusMeta>;

export interface ContractStatusBadgeProps<S extends string> {
  status: S;
  map: ContractStatusMap<S>;
  /** Prefix for the accessible label, e.g. `Trade state`. */
  kind?: string;
  className?: string;
}

/** A badge showing the given contract status. */
export function ContractStatusBadge<S extends string>({
  status,
  map,
  kind = 'Contract status',
  className,
}: ContractStatusBadgeProps<S>) {
  const meta = map[status];
  if (!meta) return null;
  return (
    <Badge
      variant={meta.tone}
      className={className}
      aria-label={`${kind}: ${meta.label}`}
    >
      {meta.label}
    </Badge>
  );
}
