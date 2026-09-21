import type { ReactNode } from 'react';

// app/(marketing)/safety/stage-rail.tsx
//
// Chrome for the safety page's stage rail. Content lives in `page.tsx`.
//
// WHY A NUMBERED RAIL RATHER THAN TOPIC HEADINGS. Every precaution on that page is "do
// this now, and it is worth nothing later" — photograph before you seal, photograph
// before you open, dispute before the window shuts. Topic buckets ("payments",
// "postage", "disputes") lose the only thing the member needs, which is WHEN, so the
// ordinals encode a real sequence and the rail mirrors `ContractProgressRail` — the
// shape a member already knows from a live contract room.
//
// THE WINDOW IS THE SIGNATURE. It is required rather than optional: a stage with no
// stated window is one nobody thought about, and "none, this completes instantly" is
// the most important sentence on the in-person path.
//
// PALETTE. `--iris` appears only as the numeral ring and the list markers, which is
// what globals.css sanctions it for. Containers stay neutral on `--border`, numerals
// take `iris-ink` because `iris` is non-text at 3.85:1, and `--trust` is deliberately
// absent — it means verified identity, and a safety page is the most tempting place in
// the product to spend it on reassurance it does not carry.

export interface Stage {
  /** Short imperative name for the moment, e.g. "The moment it arrives". */
  title: string;
  /** How long the member has here. Plain language, and never omitted. */
  window: string;
  /** What to do. One line each, imperative, fact before reason. */
  moves: ReactNode[];
}

// NO `space-y` ON THE LIST; the gap is `pb-section` on each item instead. The connector
// has to reach the NEXT numeral, so the gap must sit inside the item's own box — with
// `space-y` the line stops at the item's bottom edge and leaves a 2rem break above every
// marker, reading as a segmented rail rather than one spine.
export function StageRail({ stages, idPrefix }: { stages: readonly Stage[]; idPrefix: string }) {
  return (
    <ol>
      {stages.map((stage, index) => (
        <li
          key={stage.title}
          className="relative pb-section pl-12 last:pb-0 before:absolute before:bottom-0 before:left-[1.125rem] before:top-10 before:w-px before:bg-border last:before:hidden sm:pl-14"
        >
          <span
            aria-hidden
            className="absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-full border border-iris/40 bg-card text-meta font-semibold tabular-nums text-iris-ink"
          >
            {String(index + 1).padStart(2, '0')}
          </span>

          <div className="space-y-cozy">
            <h3
              id={`${idPrefix}-stage-${index + 1}`}
              className="text-subhead font-semibold text-foreground"
            >
              {stage.title}
            </h3>

            {/* Its own bordered row so it reads as a fact about the stage rather than
                the first bullet of advice. Neutral by design: the rail already spends
                the page's one accent, and five toned chips would compete with the two
                real callouts. */}
            <p className="flex flex-wrap items-baseline gap-x-snug gap-y-tight rounded-md border border-border bg-muted px-cozy py-snug">
              <span className="market-label text-muted-foreground">Your window</span>
              <span className="text-body font-medium text-foreground">{stage.window}</span>
            </p>

            <ul className="list-disc space-y-snug pl-5 text-body text-muted-foreground marker:text-iris">
              {stage.moves.map((move, moveIndex) => (
                <li key={moveIndex} className="text-pretty">
                  {move}
                </li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** One role's panel: a line of framing, then that role's stages. */
export function RolePanel({
  headingId,
  heading,
  lede,
  stages,
  idPrefix,
}: {
  headingId: string;
  heading: string;
  lede: string;
  stages: readonly Stage[];
  idPrefix: string;
}) {
  return (
    <section aria-labelledby={headingId} className="space-y-section">
      {/* The strip names this panel visually, so the heading serves the document
          outline and heading navigation. These are URL tabs rather than an ARIA tabs
          widget, so nothing else pairs a label to this panel. */}
      <h2 id={headingId} className="sr-only">
        {heading}
      </h2>
      <p className="max-w-prose text-pretty text-body text-muted-foreground">{lede}</p>
      <StageRail stages={stages} idPrefix={idPrefix} />
    </section>
  );
}

/** A role-independent block below the tabs. */
export function SafetySection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-cozy">
      <h2 className="text-head font-semibold tracking-tight text-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** Bulleted guidance inside a {@link SafetySection}. */
export function SafetyList({ items }: { items: readonly ReactNode[] }) {
  return (
    <ul className="list-disc space-y-snug pl-5 text-body text-muted-foreground marker:text-iris">
      {items.map((item, index) => (
        <li key={index} className="text-pretty">
          {item}
        </li>
      ))}
    </ul>
  );
}
