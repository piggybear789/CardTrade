'use client';

// components/references/ReferenceGraph.tsx
//
// Cross-platform Reference Vector Graph (0155):
//   * Synthesises all deals across Instagram, Facebook, Discord, eBay,
//     Whatnot, In-person, and NoDitto Escrow into one interactive vector
//     network.
//   * SaaS node-pill cards connected by smooth cubic Bezier vector paths on a
//     dot-grid canvas, with platform filter pills, zoom/pan controls, an
//     interactive node inspector, and a written experiences feed below.

import { useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  ShieldCheckIcon,
} from '@hugeicons/core-free-icons';

import { Avatar } from '@/components/ui/avatar';
import type { ReferenceGraphData, ReferenceGraphNode } from '@/lib/references/graph';
import { platformLabel } from '@/domain/references/reference';
import { cn } from '@/lib/utils';

const PLATFORM_DOT_COLOR: Record<string, string> = {
  instagram: '#E1306C',
  facebook: '#1877F2',
  discord: '#5865F2',
  ebay: '#E53238',
  whatnot: '#F59E0B',
  'in-person': '#10B981',
  noditto: '#6366F1',
  other: '#71717A',
};

function platformColor(slug: string): string {
  return PLATFORM_DOT_COLOR[slug] ?? '#6366F1';
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** Smooth cubic Bezier path between (x1, y1) and (x2, y2) with radial curvature. */
function curvedEdgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx1 = Math.round(x1 + dx * 0.42);
  const cy1 = Math.round(y1 + dy * 0.12);
  const cx2 = Math.round(x1 + dx * 0.68);
  const cy2 = Math.round(y1 + dy * 0.88);
  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

function edgeColor(node: ReferenceGraphNode, isSelected: boolean): string {
  if (node.sentiment === 'NEGATIVE') return 'hsl(var(--destructive))';
  if (isSelected) return platformColor(node.platform);
  if (node.kind === 'escrow') return 'hsl(var(--primary))';
  if (node.kind === 'receipt') return 'hsl(var(--trust))';
  return 'hsl(var(--border))';
}

export function ReferenceGraph({
  data,
  action,
}: {
  data: ReferenceGraphData;
  /** The ShareExperience control (or the owner's share link control). */
  action?: ReactNode;
}) {
  const { centre } = data;
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(
    data.nodes.find((n) => n.sentiment === 'POSITIVE')?.id ?? data.nodes[0]?.id ?? null,
  );
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; origX: number; origY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  const filteredNodes = useMemo(() => {
    if (platformFilter === 'all') return data.nodes;
    return data.nodes.filter((n) => n.platforms.includes(platformFilter));
  }, [data.nodes, platformFilter]);

  const selectedNode = useMemo(() => {
    return (
      data.nodes.find((n) => n.id === selectedId) ??
      filteredNodes[0] ??
      data.nodes[0] ??
      null
    );
  }, [data.nodes, filteredNodes, selectedId]);

  const totalEdges = centre.referenceCount + centre.negativeCount;
  const positivePct =
    totalEdges > 0 ? Math.round((centre.referenceCount / totalEdges) * 100) : 100;

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest('[data-node-card="true"]')) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan({
      x: Math.max(-220, Math.min(220, dragRef.current.origX + dx)),
      y: Math.max(-160, Math.min(160, dragRef.current.origY + dy)),
    });
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const resetViewport = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <section
      aria-labelledby="references-heading"
      className="overflow-hidden rounded-2xl border border-border/90 bg-card shadow-xs"
    >
      {/* Top SaaS Synthesis Header */}
      <div className="flex flex-col gap-3 border-b border-border/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3
              id="references-heading"
              className="text-[1.0625rem] font-semibold tracking-tight text-foreground"
            >
              Trust Network
            </h3>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/50 px-2.5 py-0.5 text-meta font-medium tabular-nums text-foreground">
              <span>{centre.referenceCount}</span>
              <span className="text-muted-foreground">
                {centre.referenceCount === 1 ? 'reference' : 'references'}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/50 px-2.5 py-0.5 text-meta font-medium tabular-nums text-foreground">
              <span>{centre.peopleCount}</span>
              <span className="text-muted-foreground">
                {centre.peopleCount === 1 ? 'person' : 'people'}
              </span>
            </span>
            {totalEdges > 0 ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-meta font-semibold tabular-nums',
                  centre.negativeCount === 0
                    ? 'bg-trust/10 text-trust'
                    : 'bg-amber-500/10 text-amber-700',
                )}
              >
                {positivePct}% positive
              </span>
            ) : null}
            {centre.negativeCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-meta font-semibold tabular-nums text-destructive">
                {centre.negativeCount} negative
              </span>
            ) : null}
          </div>
          <p className="text-meta text-muted-foreground">
            Synthesised across every platform {centre.handle} has dealt on. Select any node to
            inspect the deal.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">{action}</div>
      </div>

      {/* Cross-Platform Filter Strip */}
      {centre.platforms.length > 0 ? (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border/70 bg-muted/25 px-5 py-2.5">
          <span className="mr-1 shrink-0 text-meta font-medium text-muted-foreground">
            Platforms
          </span>
          <button
            type="button"
            onClick={() => setPlatformFilter('all')}
            aria-pressed={platformFilter === 'all'}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-meta font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              platformFilter === 'all'
                ? 'border-foreground bg-foreground text-background shadow-2xs'
                : 'border-border/80 bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
            )}
          >
            All
            <span className="tabular-nums opacity-75">{data.nodes.length}</span>
          </button>
          {centre.platforms.map((plat) => {
            const active = platformFilter === plat.slug;
            return (
              <button
                key={plat.slug}
                type="button"
                onClick={() =>
                  setPlatformFilter((current) => (current === plat.slug ? 'all' : plat.slug))
                }
                aria-pressed={active}
                className={cn(
                  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-meta font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-foreground bg-foreground text-background shadow-2xs'
                    : 'border-border/80 bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                )}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: platformColor(plat.slug) }}
                  aria-hidden
                />
                <span>{plat.label}</span>
                <span className="tabular-nums opacity-75">{plat.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Main Interactive Vector Graph Canvas */}
      {data.nodes.length === 0 ? (
        <div className="relative flex min-h-[340px] flex-col items-center justify-center bg-muted/15 px-6 py-14 text-center">
          <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl border border-border bg-card shadow-xs">
            <span className="text-lead font-semibold text-foreground">
              {centre.name.replace(/^@/, '').slice(0, 2).toUpperCase()}
            </span>
          </div>
          <p className="text-body font-semibold text-foreground">{centre.handle}</p>
          <p className="mt-1 max-w-md text-body text-muted-foreground">
            No experiences recorded yet across Instagram, Facebook, Discord, or NoDitto. If you
            have done a deal with {centre.handle}, add the first node to their graph.
          </p>
        </div>
      ) : (
        <div className="relative select-none overflow-hidden bg-muted/15">
          <svg
            viewBox={`0 0 ${data.width} ${data.height}`}
            className="block h-[420px] w-full cursor-grab active:cursor-grabbing sm:h-[540px]"
            role="img"
            aria-label={`Reference vector graph for ${centre.handle}: ${centre.referenceCount} references from ${centre.peopleCount} people`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <defs>
              {/* SaaS Dot Grid Pattern */}
              <pattern id="ref-dot-grid" width="22" height="22" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1" fill="hsl(var(--border))" />
              </pattern>
              {/* Subtle card drop shadow */}
              <filter id="ref-node-shadow" x="-15%" y="-15%" width="130%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000000" floodOpacity="0.06" />
              </filter>
              <filter id="ref-hub-shadow" x="-20%" y="-20%" width="140%" height="150%">
                <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#000000" floodOpacity="0.14" />
              </filter>
            </defs>

            {/* Canvas Dot Grid */}
            <rect width={data.width} height={data.height} fill="url(#ref-dot-grid)" />

            <g
              transform={`translate(${pan.x}, ${pan.y}) translate(${data.centreX}, ${data.centreY}) scale(${zoom}) translate(${-data.centreX}, ${-data.centreY})`}
            >
              {/* Subtle Radial Orbit Rings */}
              <ellipse
                cx={data.centreX}
                cy={data.centreY}
                rx={165}
                ry={118}
                fill="none"
                stroke="hsl(var(--border))"
                strokeWidth={1}
                strokeDasharray="3 5"
                opacity={0.65}
              />
              <ellipse
                cx={data.centreX}
                cy={data.centreY}
                rx={270}
                ry={192}
                fill="none"
                stroke="hsl(var(--border))"
                strokeWidth={1}
                strokeDasharray="4 6"
                opacity={0.55}
              />

              {/* 2nd-Degree Curved Vector Edges & Satellite Pills */}
              { data.nodes.flatMap((node) => {
                const parentDimmed =
                  platformFilter !== 'all' && !node.platforms.includes(platformFilter);
                const parentSelected = node.id === selectedNode?.id;
                return node.children.map((child) => {
                  const pathD = curvedEdgePath(node.x, node.y, child.x, child.y);
                  return (
                    <g
                      key={child.id}
                      opacity={parentDimmed ? 0.14 : parentSelected ? 0.95 : 0.55}
                      data-node-card="true"
                    >
                      <path
                        d={pathD}
                        fill="none"
                        stroke={parentSelected ? platformColor(node.platform) : 'hsl(var(--border))'}
                        strokeWidth={parentSelected ? 1.75 : 1.25}
                        strokeDasharray="3 3"
                      />
                      <Link href={`/references/${encodeURIComponent(child.handleSlug)}`}>
                        <g className="cursor-pointer" filter="url(#ref-node-shadow)">
                          <rect
                            x={child.x - 52}
                            y={child.y - 13}
                            width={104}
                            height={26}
                            rx={13}
                            fill="hsl(var(--card))"
                            stroke="hsl(var(--border))"
                            strokeWidth={1}
                          />
                          <circle
                            cx={child.x - 38}
                            cy={child.y}
                            r={9}
                            fill="hsl(var(--muted))"
                          />
                          <text
                            x={child.x - 38}
                            y={child.y + 3}
                            textAnchor="middle"
                            fontSize={7.5}
                            fontWeight={700}
                            fill="hsl(var(--muted-foreground))"
                          >
                            {child.initials}
                          </text>
                          <text
                            x={child.x - 24}
                            y={child.y + 3.5}
                            fontSize={9.5}
                            fontWeight={600}
                            fill="hsl(var(--foreground))"
                          >
                            {truncateText(child.handle, 10)}
                          </text>
                        </g>
                      </Link>
                    </g>
                  );
                });
              }) }

              {/* 1st-Degree Curved Bezier Vector Connectors */}
              {data.nodes.map((node) => {
                const isSelected = node.id === selectedNode?.id;
                const dimmed =
                  platformFilter !== 'all' && !node.platforms.includes(platformFilter);
                const stroke = edgeColor(node, isSelected);
                const pathD = curvedEdgePath(data.centreX, data.centreY, node.x, node.y);
                const mx = Math.round((data.centreX + node.x) / 2);
                const my = Math.round((data.centreY + node.y) / 2);
                const badgeText =
                  node.deals > 1 ? `${node.platformShort} · ${node.deals}x` : node.platformShort;
                const badgeWidth = Math.max(36, badgeText.length * 6.2 + 14);

                return (
                  <g key={`edge-${node.id}`} opacity={dimmed ? 0.16 : 1}>
                    {/* Soft glow behind selected vector path */}
                    {isSelected ? (
                      <path
                        d={pathD}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={7}
                        strokeLinecap="round"
                        opacity={0.16}
                      />
                    ) : null}
                    <path
                      d={pathD}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={isSelected ? 2.5 : Math.min(2.25, 1.35 + (node.deals - 1) * 0.35)}
                      strokeLinecap="round"
                      strokeDasharray={node.sentiment === 'NEGATIVE' ? '5 4' : undefined}
                    />
                    {/* Mid-curve platform & deal count pill */}
                    <g>
                      <rect
                        x={mx - badgeWidth / 2}
                        y={my - 9}
                        width={badgeWidth}
                        height={18}
                        rx={9}
                        fill={isSelected ? stroke : 'hsl(var(--card))'}
                        stroke={isSelected ? stroke : 'hsl(var(--border))'}
                        strokeWidth={1}
                      />
                      <text
                        x={mx}
                        y={my + 3.5}
                        textAnchor="middle"
                        fontSize={8.5}
                        fontWeight={700}
                        fill={isSelected ? '#FFFFFF' : 'hsl(var(--muted-foreground))'}
                      >
                        {badgeText}
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* 1st-Degree SaaS Node Cards */}
              {data.nodes.map((node) => {
                const isSelected = node.id === selectedNode?.id;
                const dimmed =
                  platformFilter !== 'all' && !node.platforms.includes(platformFilter);
                const cardW = 166;
                const cardH = 48;
                const left = node.x - cardW / 2;
                const top = node.y - cardH / 2;
                const accent = edgeColor(node, isSelected);
                const platDot = platformColor(node.platform);

                return (
                  <g
                    key={node.id}
                    data-node-card="true"
                    onClick={() => setSelectedId(node.id)}
                    className="cursor-pointer"
                    opacity={dimmed ? 0.22 : 1}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.handle}, ${node.roleShortLabel} on ${node.platformLabel}, ${node.refs} references`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(node.id);
                      }
                    }}
                  >
                    {/* Selection outer ring */}
                    {isSelected ? (
                      <rect
                        x={left - 3}
                        y={top - 3}
                        width={cardW + 6}
                        height={cardH + 6}
                        rx={17}
                        fill="none"
                        stroke={accent}
                        strokeWidth={2}
                        opacity={0.85}
                      />
                    ) : null}

                    {/* Card body */}
                    <rect
                      x={left}
                      y={top}
                      width={cardW}
                      height={cardH}
                      rx={14}
                      fill="hsl(var(--card))"
                      stroke={isSelected ? accent : 'hsl(var(--border))'}
                      strokeWidth={isSelected ? 1.5 : 1}
                      filter="url(#ref-node-shadow)"
                    />

                    {/* Connection port dot on the side facing the hub */}
                    <circle
                      cx={node.x < data.centreX ? left + cardW : left}
                      cy={node.y}
                      r={3.5}
                      fill={accent}
                      stroke="hsl(var(--card))"
                      strokeWidth={1.5}
                    />

                    {/* Avatar circle */}
                    <circle
                      cx={left + 24}
                      cy={node.y}
                      r={15}
                      fill={
                        node.sentiment === 'NEGATIVE'
                          ? 'hsl(var(--destructive) / 0.12)'
                          : 'hsl(var(--muted))'
                      }
                      stroke={
                        node.sentiment === 'NEGATIVE'
                          ? 'hsl(var(--destructive))'
                          : node.kind !== 'vouch'
                            ? 'hsl(var(--trust))'
                            : 'hsl(var(--border))'
                      }
                      strokeWidth={1.5}
                    />
                    <text
                      x={left + 24}
                      y={node.y + 3.5}
                      textAnchor="middle"
                      fontSize={10.5}
                      fontWeight={700}
                      fill={
                        node.sentiment === 'NEGATIVE'
                          ? 'hsl(var(--destructive))'
                          : 'hsl(var(--foreground))'
                      }
                    >
                      {node.initials}
                    </text>

                    {/* Platform color dot on avatar */}
                    <circle
                      cx={left + 35}
                      cy={node.y + 11}
                      r={4.5}
                      fill={platDot}
                      stroke="hsl(var(--card))"
                      strokeWidth={1.5}
                    />

                    {/* Handle & Role + Platform subline */}
                    <text
                      x={left + 46}
                      y={node.y - 3.5}
                      fontSize={11.5}
                      fontWeight={650}
                      fill="hsl(var(--foreground))"
                    >
                      {truncateText(node.handle, 13)}
                    </text>
                    <text
                      x={left + 46}
                      y={node.y + 11}
                      fontSize={9.5}
                      fontWeight={500}
                      fill={
                        node.sentiment === 'NEGATIVE'
                          ? 'hsl(var(--destructive))'
                          : 'hsl(var(--muted-foreground))'
                      }
                    >
                      {node.sentiment === 'NEGATIVE'
                        ? `Negative · ${node.platformShort}`
                        : `${node.roleShortLabel} · ${node.platforms.length > 1 ? `${node.platforms.length} platforms` : node.platformShort}`}
                    </text>

                    {/* Referee's own standing pill on right */}
                    <rect
                      x={left + cardW - 34}
                      y={node.y - 10}
                      width={26}
                      height={20}
                      rx={6}
                      fill="hsl(var(--muted))"
                    />
                    <text
                      x={left + cardW - 21}
                      y={node.y + 3.5}
                      textAnchor="middle"
                      fontSize={9.5}
                      fontWeight={700}
                      fill="hsl(var(--foreground))"
                    >
                      {node.refs}
                    </text>
                  </g>
                );
              })}

              {/* Centre Hub Node (The Synthesised Person) */}
              <g filter="url(#ref-hub-shadow)" data-node-card="true">
                <circle
                  cx={data.centreX}
                  cy={data.centreY}
                  r={58}
                  fill="hsl(var(--card))"
                  stroke="hsl(var(--border))"
                  strokeWidth={1.5}
                />
                <circle
                  cx={data.centreX}
                  cy={data.centreY}
                  r={51}
                  fill="hsl(var(--foreground))"
                />
                <text
                  x={data.centreX}
                  y={data.centreY - 12}
                  textAnchor="middle"
                  fontSize={16}
                  fontWeight={700}
                  fill="hsl(var(--background))"
                >
                  {centre.name.replace(/^@/, '').slice(0, 2).toUpperCase()}
                </text>
                <text
                  x={data.centreX}
                  y={data.centreY + 4}
                  textAnchor="middle"
                  fontSize={10.5}
                  fontWeight={600}
                  fill="hsl(var(--background))"
                >
                  {truncateText(centre.handle, 14)}
                </text>
                <text
                  x={data.centreX}
                  y={data.centreY + 19}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight={600}
                  fill="hsl(var(--muted))"
                  opacity={0.85}
                >
                  {centre.referenceCount} {centre.referenceCount === 1 ? 'ref' : 'refs'} ·{' '}
                  {Math.max(1, centre.platforms.length)}{' '}
                  {centre.platforms.length === 1 ? 'platform' : 'platforms'}
                </text>
              </g>
            </g>
          </svg>

          {/* Bottom-Left Floating Canvas Toolbar (Runway / Clay style) */}
          <div className="absolute bottom-3.5 left-3.5 flex items-center gap-1 rounded-full border border-border/90 bg-card/95 p-1 shadow-sm backdrop-blur-md">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.5, Number((z + 0.15).toFixed(2))))}
              aria-label="Zoom in"
              className="inline-flex size-7 items-center justify-center rounded-full text-body font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              +
            </button>
            <span className="px-1.5 text-meta font-medium tabular-nums text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.7, Number((z - 0.15).toFixed(2))))}
              aria-label="Zoom out"
              className="inline-flex size-7 items-center justify-center rounded-full text-body font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              −
            </button>
            {zoom !== 1 || pan.x !== 0 || pan.y !== 0 ? (
              <button
                type="button"
                onClick={resetViewport}
                className="rounded-full px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-muted"
              >
                Reset
              </button>
            ) : null}
          </div>

          {/* Floating Selected Node Inspector Card (Bottom-Right) */}
          {selectedNode ? (
            <div className="m-3 rounded-2xl border border-border/90 bg-card/95 p-4 shadow-lg backdrop-blur-md sm:absolute sm:bottom-3.5 sm:right-3.5 sm:m-0 sm:w-80">
              <div className="flex items-start justify-between gap-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar
                    avatarPath={selectedNode.avatarPath}
                    displayName={selectedNode.name}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-body font-semibold text-foreground">
                        {selectedNode.handle}
                      </span>
                      {selectedNode.identityVerified ? (
                        <HugeiconsIcon
                          icon={ShieldCheckIcon}
                          className="size-3.5 shrink-0 text-trust"
                          aria-hidden
                        />
                      ) : null}
                    </div>
                    <p className="truncate text-meta text-muted-foreground">
                      {selectedNode.name} · {selectedNode.refs}{' '}
                      {selectedNode.refs === 1 ? 'reference' : 'references'}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold',
                    selectedNode.sentiment === 'NEGATIVE'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-trust/10 text-trust',
                  )}
                >
                  <HugeiconsIcon
                    icon={
                      selectedNode.sentiment === 'NEGATIVE'
                        ? AlertCircleIcon
                        : CheckmarkCircle02Icon
                    }
                    className="size-3"
                    aria-hidden
                  />
                  {selectedNode.sentiment === 'NEGATIVE' ? 'Negative' : 'Positive'}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-meta">
                <span className="rounded-md bg-muted px-2 py-0.5 font-medium text-foreground">
                  {selectedNode.roleLabel}
                </span>
                {selectedNode.platforms.map((plat) => (
                  <span
                    key={plat}
                    className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-card px-2 py-0.5 font-medium text-foreground"
                  >
                    <span
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: platformColor(plat) }}
                      aria-hidden
                    />
                    {platformLabel(plat)}
                  </span>
                ))}
                {selectedNode.deals > 1 ? (
                  <span className="rounded-md bg-muted px-2 py-0.5 font-medium tabular-nums text-muted-foreground">
                    {selectedNode.deals} deals
                  </span>
                ) : null}
                {selectedNode.dateLabel ? (
                  <span className="text-muted-foreground">· {selectedNode.dateLabel}</span>
                ) : null}
              </div>

              {selectedNode.comment ? (
                <blockquote className="mt-2.5 rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-body text-foreground">
                  &ldquo;{selectedNode.comment}&rdquo;
                </blockquote>
              ) : null}

              <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-2.5">
                <span className="text-meta text-muted-foreground">
                  {selectedNode.kind === 'escrow'
                    ? 'Verified NoDitto escrow'
                    : selectedNode.kind === 'receipt'
                      ? 'Receipt checked'
                      : 'ID-verified member'}
                </span>
                <Link
                  href={`/references/${encodeURIComponent(selectedNode.handleSlug)}`}
                  className="text-meta font-semibold text-iris-ink hover:underline"
                >
                  Open {selectedNode.handle} →
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Written Experiences & Cross-Platform Feed */}
      {filteredNodes.length > 0 ? (
        <div className="border-t border-border/80 bg-card px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-meta font-semibold uppercase tracking-wider text-muted-foreground">
              Experiences ({filteredNodes.length})
            </h4>
          </div>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {filteredNodes.map((node) => {
              const isSelected = node.id === selectedNode?.id;
              return (
                <li key={node.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(node.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(node.id);
                      }
                    }}
                    className={cn(
                      'group flex h-full cursor-pointer flex-col justify-between rounded-xl border p-3.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isSelected
                        ? 'border-foreground/40 bg-muted/30 shadow-2xs'
                        : 'border-border/80 bg-card hover:border-foreground/25 hover:bg-muted/15',
                    )}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar
                            avatarPath={node.avatarPath}
                            displayName={node.name}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <Link
                                href={`/references/${encodeURIComponent(node.handleSlug)}`}
                                onClick={(e) => e.stopPropagation()}
                                className="truncate text-body font-semibold text-foreground hover:underline"
                              >
                                {node.handle}
                              </Link>
                              {node.identityVerified ? (
                                <HugeiconsIcon
                                  icon={ShieldCheckIcon}
                                  className="size-3.5 shrink-0 text-trust"
                                  aria-hidden
                                />
                              ) : null}
                            </div>
                            <p className="text-meta text-muted-foreground">
                              {node.refs} {node.refs === 1 ? 'ref' : 'refs'} · {node.roleLabel}
                            </p>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {node.platforms.map((plat) => (
                            <span
                              key={plat}
                              className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 text-meta font-medium text-foreground"
                            >
                              <span
                                className="size-1.5 rounded-full"
                                style={{ backgroundColor: platformColor(plat) }}
                                aria-hidden
                              />
                              {platformLabel(plat)}
                            </span>
                          ))}
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-meta font-semibold',
                              node.sentiment === 'NEGATIVE'
                                ? 'bg-destructive/10 text-destructive'
                                : 'bg-trust/10 text-trust',
                            )}
                          >
                            {node.sentiment === 'NEGATIVE' ? 'Negative' : 'Positive'}
                          </span>
                        </div>
                      </div>

                      {node.comment ? (
                        <p className="mt-2.5 text-body text-foreground/90">
                          &ldquo;{node.comment}&rdquo;
                        </p>
                      ) : null}
                    </div>

                    <div className="mt-2.5 flex items-center justify-between text-meta text-muted-foreground">
                      <span>
                        {node.kind === 'escrow'
                          ? 'NoDitto Escrow'
                          : node.kind === 'receipt'
                            ? 'Receipt checked'
                            : 'ID verified'}
                        {node.deals > 1 ? ` · ${node.deals} deals` : ''}
                      </span>
                      {node.dateLabel ? <span>{node.dateLabel}</span> : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
