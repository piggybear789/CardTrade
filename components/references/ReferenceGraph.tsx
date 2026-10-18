'use client';

// components/references/ReferenceGraph.tsx
//
// The reference graph (0155): the seller as the centre node, referees
// radiating out. Node size is the referee's own positive reference count,
// line thickness (and the Nx bubble) is deals together, colour is how the
// reference was earned (escrow / receipt-checked / vouch), and a negative
// experience is a dashed destructive edge that never nets off the positives.
// No filters, toggles or panels: tapping a node opens that person's graph.

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import type { ReferenceGraphData, ReferenceGraphNode } from '@/lib/references/graph';

const INK = 'hsl(var(--foreground))';
const BORDER = 'hsl(var(--border))';
const MUTED = 'hsl(var(--muted-foreground))';
const PRIMARY = 'hsl(var(--primary))';
const TRUST = 'hsl(var(--trust))';
const DESTRUCTIVE = 'hsl(var(--destructive))';
const CARD = 'hsl(var(--card))';
const SOFT = 'hsl(var(--muted))';

function kindStroke(node: ReferenceGraphNode): string {
  if (node.sentiment === 'NEGATIVE') return DESTRUCTIVE;
  if (node.kind === 'escrow') return PRIMARY;
  if (node.kind === 'receipt') return TRUST;
  return BORDER;
}

export function ReferenceGraph({
  data,
  action,
}: {
  data: ReferenceGraphData;
  /** The ShareExperience control (or the owner's copy-link control). */
  action?: ReactNode;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(
    data.nodes.find((n) => n.sentiment === 'POSITIVE')?.id ?? data.nodes[0]?.id ?? null,
  );
  const { centre } = data;

  const openNode = (node: ReferenceGraphNode) => {
    setSelectedId(node.id);
    if (node.profileId !== centre.profileId) {
      router.push(`/sellers/${node.profileId}`);
    }
  };

  return (
    <section aria-labelledby="references-heading" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-cozy gap-y-snug border-b border-border px-group py-cozy">
        <div className="min-w-0 flex-1">
          <h3 id="references-heading" className="text-lead font-semibold tracking-tight text-foreground">
            References
          </h3>
          <p className="mt-0.5 text-body text-muted-foreground">
            <span className="font-medium text-foreground">{centre.referenceCount}</span>{' '}
            {centre.referenceCount === 1 ? 'reference' : 'references'} from{' '}
            <span className="font-medium text-foreground">{centre.peopleCount}</span>{' '}
            {centre.peopleCount === 1 ? 'person' : 'people'}
            {centre.negativeCount > 0 ? (
              <>
                {' · '}
                <span className="font-medium text-destructive">
                  {centre.negativeCount} negative {centre.negativeCount === 1 ? 'experience' : 'experiences'}
                </span>
              </>
            ) : null}
            {centre.checkedCount > 0 ? <> · {centre.checkedCount} receipt-checked or escrow</> : null}
          </p>
        </div>
        {action}
      </div>

      {data.nodes.length === 0 ? (
        <p className="px-group py-section text-center text-body text-muted-foreground">
          No references yet. {centre.unclaimed ? 'Be the first to share an experience with this handle.' : 'Be the first to share an experience.'}
        </p>
      ) : (
        <div className="bg-background">
          <svg
            viewBox={`0 0 ${data.width} ${data.height}`}
            className="block h-auto w-full"
            role="img"
            aria-label={`Reference network for ${centre.handle}: ${centre.referenceCount} references from ${centre.peopleCount} people${centre.negativeCount > 0 ? `, ${centre.negativeCount} negative experiences` : ''}`}
          >
            {/* Second-degree edges and nodes */}
            {data.nodes.flatMap((node) =>
              node.children.map((child) => (
                <g key={child.id} opacity={0.75}>
                  <line x1={node.x} y1={node.y} x2={child.x} y2={child.y} stroke={BORDER} strokeWidth={1.5} />
                  <circle cx={child.x} cy={child.y} r={child.r} fill={SOFT} stroke={CARD} strokeWidth={2.5} />
                  <text x={child.x} y={child.y + 3.5} textAnchor="middle" fontSize={8.5} fontWeight={700} fill={MUTED}>
                    {child.initials}
                  </text>
                  <text x={child.x} y={child.y + child.r + 12} textAnchor="middle" fontSize={8.5} fill={MUTED}>
                    {child.handle} · {child.refs}
                  </text>
                </g>
              )),
            )}

            {/* Edges, deal bubbles, selected label */}
            {data.nodes.map((node) => {
              const isSelected = node.id === selectedId;
              const mx = (data.centreX + node.x) / 2;
              const my = (data.centreY + node.y) / 2;
              const label =
                node.sentiment === 'NEGATIVE'
                  ? `${node.categoryLabel ?? 'Negative experience'} · ${node.dateLabel ?? ''}`
                  : `${node.roleLabel} · ${node.dateLabel ?? ''}`;
              return (
                <g key={`e-${node.id}`} opacity={selectedId && !isSelected ? 0.55 : 1}>
                  <line
                    x1={data.centreX}
                    y1={data.centreY}
                    x2={node.x}
                    y2={node.y}
                    stroke={isSelected ? kindStroke(node) : BORDER}
                    strokeWidth={isSelected ? 4.5 : 1.5 + node.deals}
                    strokeDasharray={node.sentiment === 'NEGATIVE' ? '6 5' : undefined}
                  />
                  {node.deals > 1 ? (
                    <g>
                      <circle cx={mx} cy={my} r={10} fill={isSelected ? kindStroke(node) : CARD} stroke={BORDER} strokeWidth={1.5} />
                      <text x={mx} y={my + 3.5} textAnchor="middle" fontSize={9} fontWeight={800} fill={isSelected ? CARD : MUTED}>
                        {node.deals}x
                      </text>
                    </g>
                  ) : null}
                  {isSelected ? (
                    <g>
                      <rect x={mx - Math.max(70, label.length * 3.4)} y={my - 36} width={Math.max(140, label.length * 6.8)} height={22} rx={11} fill={INK} />
                      <text x={mx} y={my - 21.5} textAnchor="middle" fontSize={10} fontWeight={650} fill={CARD}>
                        {label}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}

            {/* Referee nodes */}
            {data.nodes.map((node) => {
              const isSelected = node.id === selectedId;
              return (
                <g
                  key={node.id}
                  onClick={() => openNode(node)}
                  className="cursor-pointer"
                  opacity={selectedId && !isSelected ? 0.75 : 1}
                  role="button"
                  aria-label={`${node.handle}, ${node.refs} references. Open their profile.`}
                >
                  {isSelected ? (
                    <circle cx={node.x} cy={node.y} r={node.r + 7} fill="none" stroke={kindStroke(node)} strokeWidth={2} />
                  ) : null}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.r}
                    fill={node.sentiment === 'NEGATIVE' ? 'hsl(var(--destructive) / 0.12)' : SOFT}
                    stroke={CARD}
                    strokeWidth={3}
                  />
                  <text x={node.x} y={node.y + 1} textAnchor="middle" fontSize={node.r > 24 ? 14 : 11} fontWeight={700} fill={INK}>
                    {node.initials}
                  </text>
                  <text x={node.x} y={node.y + 14} textAnchor="middle" fontSize={8.5} fill={MUTED}>
                    {node.refs} refs
                  </text>
                  <text x={node.x} y={node.y + node.r + 17} textAnchor="middle" fontSize={11.5} fontWeight={isSelected ? 700 : 600} fill={INK}>
                    {node.handle}
                  </text>
                  <text x={node.x} y={node.y + node.r + 30} textAnchor="middle" fontSize={9.5} fill={MUTED}>
                    {node.sentiment === 'NEGATIVE'
                      ? `Negative · ${node.dateLabel ?? ''}`
                      : `${node.platform === 'noditto' ? 'NoDitto escrow' : node.platform} · ${node.deals} deal${node.deals === 1 ? '' : 's'} · ${node.dateLabel ?? ''}`}
                  </text>
                  {/* Platform badge */}
                  <g>
                    <circle cx={node.x + node.r - 2} cy={node.y + node.r - 4} r={9.5} fill={CARD} stroke={BORDER} strokeWidth={1.2} />
                    <text x={node.x + node.r - 2} y={node.y + node.r - 0.8} textAnchor="middle" fontSize={7} fontWeight={800} fill={MUTED}>
                      {node.platformShort}
                    </text>
                  </g>
                  {node.sentiment === 'POSITIVE' && node.kind !== 'vouch' ? (
                    <g>
                      <circle cx={node.x - node.r + 3} cy={node.y - node.r + 6} r={7.5} fill={kindStroke(node)} stroke={CARD} strokeWidth={2} />
                      <text x={node.x - node.r + 3} y={node.y - node.r + 9.5} textAnchor="middle" fontSize={8} fontWeight={800} fill={CARD}>
                        ✓
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}

            {/* Centre */}
            <circle cx={data.centreX} cy={data.centreY} r={54} fill={INK} stroke={CARD} strokeWidth={4} />
            <text x={data.centreX} y={data.centreY - 16} textAnchor="middle" fontSize={17} fontWeight={700} fill={CARD}>
              {centre.name.replace(/^@/, '').slice(0, 2).toUpperCase()}
            </text>
            <text x={data.centreX} y={data.centreY} textAnchor="middle" fontSize={10} fill={SOFT}>
              {centre.handle}
            </text>
            <text x={data.centreX} y={data.centreY + 15} textAnchor="middle" fontSize={9.5} fontWeight={650} fill={CARD}>
              {centre.referenceCount} references · {centre.peopleCount} people
            </text>
            <text x={data.centreX} y={data.centreY + 28} textAnchor="middle" fontSize={8.5} fill={SOFT}>
              {centre.negativeCount > 0 ? `${centre.negativeCount} negative` : `${centre.checkedCount} checked / escrow`}
            </text>
          </svg>
        </div>
      )}

      {/* Accessible equivalent of the graph: the same facts as a list. */}
      {data.nodes.length > 0 ? (
        <ul className="sr-only">
          {data.nodes.map((node) => (
            <li key={node.id}>
              {node.handle}: {node.sentiment === 'NEGATIVE' ? `negative experience (${node.categoryLabel})` : node.roleLabel} ·{' '}
              {node.deals} deal{node.deals === 1 ? '' : 's'} · {node.dateLabel}
              {node.comment ? ` — ${node.comment}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
