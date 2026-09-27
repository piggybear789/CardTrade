// components/admin/ErrorsQueue.tsx
//
// The Errors tab of the operations console (0123): one card per error GROUP (a
// fingerprint in `error_log_groups`), newest first, and a drill-down into one group's
// occurrences and the reports members filed against it.
//
// A Server Component. Everything is read by the page with the service-role client
// after its own admin gate; this only renders. The one interactive control, "Mark
// resolved", is the `ErrorGroupActions` island.
//
// WHAT AN OPERATOR NEEDS TO RESOLVE AN ERROR, in the order they need it: what failed
// (the message, the action or job, the code), how bad it is (occurrences, members hit,
// reports), where (the page and the contract ids, linked), and why (the stack). Nothing
// here is shown to a member, and no member data beyond a display name is rendered.

import type { ReactNode } from 'react';
import Link from 'next/link';

import { ErrorGroupActions } from '@/components/admin/ErrorGroupActions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/format';
import type { Database, Tables } from '@/lib/supabase/database.types';

export type ErrorLogRow = Tables<'error_logs'>;
export type ErrorGroupRow = Database['cardtrade']['Views']['error_log_groups']['Row'];

/** Which slice of the queue is on screen. Read from the URL by the page. */
export interface ErrorQueueFilters {
  /** `open` (default): groups with an unresolved occurrence. `all`: everything. */
  view: 'open' | 'all';
  /** Include ACTION failures that were a guard doing its job. Off by default. */
  refusals: boolean;
  /** A fingerprint to drill into, or null. */
  group: string | null;
}

const SOURCE_LABEL: Record<ErrorGroupRow['source'], string> = {
  SERVER: 'Server error',
  CLIENT: 'Browser error',
  ACTION: 'Action failed',
  BACKGROUND: 'Background',
  REPORT: 'Member report',
};

/** Context keys that name a contract, and where that contract lives. */
const CONTEXT_LINKS: Record<string, ((id: string) => string) | undefined> = {
  cashSaleId: (id) => `/sales/${id}`,
  tradeId: (id) => `/trades/${id}`,
  itemId: (id) => `/listings/${id}`,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Build an Errors-tab URL that keeps the current filters. */
function errorsHref(filters: ErrorQueueFilters, patch: Partial<ErrorQueueFilters>): string {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams({ tab: 'errors' });
  if (next.view === 'all') params.set('view', 'all');
  if (next.refusals) params.set('refusals', '1');
  if (next.group) params.set('group', next.group);
  return `/admin?${params.toString()}`;
}

function groupTitle(group: Pick<ErrorGroupRow, 'message' | 'name' | 'source'>): string {
  return group.message ?? group.name ?? (group.source === 'REPORT' ? 'Reported problem' : 'Unknown error');
}

function contextEntries(context: ErrorLogRow['context']): [string, string][] {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return [];
  return Object.entries(context as Record<string, unknown>)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => [key, String(value)]);
}

function FilterLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <Button asChild size="sm" variant={current ? 'secondary' : 'ghost'}>
      <Link href={href} aria-current={current ? 'page' : undefined}>
        {children}
      </Link>
    </Button>
  );
}

function Occurrence({ row, nameFor }: { row: ErrorLogRow; nameFor: (id: string) => string }) {
  const context = contextEntries(row.context);
  return (
    <li className="space-y-tight py-cozy first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-snug">
        <div className="flex flex-wrap items-center gap-snug">
          <Badge variant={row.source === 'REPORT' ? 'default' : 'secondary'}>
            {SOURCE_LABEL[row.source]}
          </Badge>
          {row.resolved_at ? <Badge variant="outline">Resolved</Badge> : null}
          <span className="text-meta text-muted-foreground">
            {row.profile_id ? nameFor(row.profile_id) : 'Guest or system'}
          </span>
        </div>
        <time
          dateTime={row.created_at}
          title={new Date(row.created_at).toLocaleString('en-AU')}
          className="shrink-0 text-meta text-muted-foreground"
        >
          {formatRelativeTime(row.created_at)}
        </time>
      </div>

      {row.source === 'REPORT' ? (
        <p className="whitespace-pre-line break-words text-body text-foreground">
          {row.note ?? 'Reported without a description.'}
        </p>
      ) : (
        <p className="break-words text-body text-foreground">{row.message}</p>
      )}

      <dl className="grid grid-cols-1 gap-x-cozy gap-y-tight text-meta text-muted-foreground sm:grid-cols-2">
        {row.path ? (
          <div className="min-w-0">
            <dt className="inline font-medium text-foreground">Page: </dt>
            <dd className="inline break-all font-mono">{row.path}</dd>
          </div>
        ) : null}
        {row.reference ? (
          <div className="min-w-0">
            <dt className="inline font-medium text-foreground">Ref: </dt>
            <dd className="inline break-all font-mono">{row.reference}</dd>
          </div>
        ) : null}
        {row.error_code ? (
          <div className="min-w-0">
            <dt className="inline font-medium text-foreground">Code: </dt>
            <dd className="inline break-all font-mono">{row.error_code}</dd>
          </div>
        ) : null}
        {context.map(([key, value]) => {
          const link = CONTEXT_LINKS[key];
          return (
            <div key={key} className="min-w-0">
              <dt className="inline font-medium text-foreground">{key}: </dt>
              <dd className="inline break-all font-mono">
                {link && UUID.test(value) ? (
                  <Link href={link(value)} className="underline underline-offset-2 hover:text-foreground">
                    {value}
                  </Link>
                ) : (
                  value
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {row.stack ? (
        <details>
          <summary className="cursor-pointer text-meta font-medium text-foreground">Stack</summary>
          <pre className="mt-tight max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted p-snug font-mono text-meta text-muted-foreground">
            {row.stack}
          </pre>
        </details>
      ) : null}
    </li>
  );
}

export function ErrorsQueue({
  groups,
  selectedGroup,
  occurrences,
  filters,
  openErrors,
  nameFor,
}: {
  groups: ErrorGroupRow[];
  selectedGroup: ErrorGroupRow | null;
  occurrences: ErrorLogRow[];
  filters: ErrorQueueFilters;
  /** Open groups that are not refusals: the tab's badge. */
  openErrors: number;
  nameFor: (id: string) => string;
}) {
  return (
    <section aria-labelledby="errors-heading">
      <div className="mb-group flex flex-wrap items-center justify-between gap-cozy">
        <div className="flex flex-wrap items-center gap-snug">
          <h3 id="errors-heading" className="text-subhead font-semibold">
            Errors
          </h3>
          {openErrors > 0 && <Badge variant="destructive">{openErrors} open</Badge>}
        </div>
        <nav aria-label="Error filters" className="flex flex-wrap gap-tight">
          <FilterLink href={errorsHref(filters, { view: 'open', group: null })} current={filters.view === 'open'}>
            Open
          </FilterLink>
          <FilterLink href={errorsHref(filters, { view: 'all', group: null })} current={filters.view === 'all'}>
            All
          </FilterLink>
          <FilterLink
            href={errorsHref(filters, { refusals: !filters.refusals, group: null })}
            current={filters.refusals}
          >
            {filters.refusals ? 'Hide refusals' : 'Show refusals'}
          </FilterLink>
        </nav>
      </div>

      <p className="mb-group text-body text-muted-foreground">
        Everything that went wrong, grouped by cause: pages that threw, errors in members&apos;
        browsers, actions that failed, background jobs and money movements, and problems members
        reported. Mark a group resolved once it is fixed; if it happens again it reopens on its
        own. Refusals, like &quot;not signed in&quot;, are a guard doing its job and are hidden
        unless you show them.
      </p>

      {selectedGroup ? (
        <Card className="mb-section">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-snug">
              <div className="min-w-0 space-y-tight">
                <div className="flex flex-wrap items-center gap-snug">
                  <Badge variant="secondary">{SOURCE_LABEL[selectedGroup.source]}</Badge>
                  {selectedGroup.expected ? <Badge variant="outline">Refusal</Badge> : null}
                  {selectedGroup.open_count > 0 ? (
                    <Badge variant="destructive">Open</Badge>
                  ) : (
                    <Badge variant="outline">Resolved</Badge>
                  )}
                </div>
                <CardTitle className="break-words text-lead">{groupTitle(selectedGroup)}</CardTitle>
                <CardDescription className="break-all font-mono">
                  {[selectedGroup.name, selectedGroup.error_code, selectedGroup.route_path ?? selectedGroup.path]
                    .filter(Boolean)
                    .join(' · ')}
                </CardDescription>
              </div>
              <div className="flex shrink-0 flex-wrap gap-snug">
                {selectedGroup.open_count > 0 ? (
                  <ErrorGroupActions fingerprint={selectedGroup.fingerprint} />
                ) : null}
                <Button asChild size="sm" variant="ghost">
                  <Link href={errorsHref(filters, { group: null })}>Close</Link>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-cozy">
            <p className="text-meta text-muted-foreground">
              {occurrences.length < selectedGroup.occurrences + selectedGroup.reports
                ? `Latest ${occurrences.length} of ${selectedGroup.occurrences + selectedGroup.reports} rows.`
                : `${occurrences.length} ${occurrences.length === 1 ? 'row' : 'rows'}.`}
            </p>
            {occurrences.length === 0 ? (
              <p className="text-body text-muted-foreground">No occurrences recorded.</p>
            ) : (
              <ol className="divide-y">
                {occurrences.map((row) => (
                  <Occurrence key={row.id} row={row} nameFor={nameFor} />
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState
          title={filters.view === 'open' ? 'No Open Errors' : 'No Errors'}
          titleAs="h4"
          description={
            filters.view === 'open'
              ? 'Nothing is failing that has not been marked resolved.'
              : 'No errors have been recorded.'
          }
          compact
        />
      ) : (
        <ul className="space-y-group">
          {groups.map((group) => (
            <li key={group.fingerprint}>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-snug">
                    <div className="flex flex-wrap items-center gap-snug">
                      <Badge variant={group.source === 'REPORT' ? 'default' : 'secondary'}>
                        {SOURCE_LABEL[group.source]}
                      </Badge>
                      {group.expected ? <Badge variant="outline">Refusal</Badge> : null}
                      {group.open_count > 0 ? (
                        <Badge variant="destructive">Open</Badge>
                      ) : (
                        <Badge variant="outline">Resolved</Badge>
                      )}
                      {group.reports > 0 ? (
                        <Badge>
                          {group.reports} {group.reports === 1 ? 'report' : 'reports'}
                        </Badge>
                      ) : null}
                    </div>
                    <time
                      dateTime={group.last_seen}
                      title={new Date(group.last_seen).toLocaleString('en-AU')}
                      className="shrink-0 text-meta text-muted-foreground"
                    >
                      {formatRelativeTime(group.last_seen)}
                    </time>
                  </div>
                  <CardTitle className="line-clamp-2 break-words text-lead">
                    {groupTitle(group)}
                  </CardTitle>
                  <CardDescription className="break-all font-mono">
                    {[group.name, group.error_code, group.route_path ?? group.path]
                      .filter(Boolean)
                      .join(' · ')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-cozy">
                  <dl className="grid grid-cols-2 gap-tight text-meta text-muted-foreground sm:grid-cols-4">
                    <div>
                      <dt className="font-medium text-foreground">Occurrences</dt>
                      <dd className="tabular-nums">{group.occurrences}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Members hit</dt>
                      <dd className="tabular-nums">{group.members_affected}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Unresolved</dt>
                      <dd className="tabular-nums">{group.open_count}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">First seen</dt>
                      <dd>{formatRelativeTime(group.first_seen)}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-snug">
                    {group.open_count > 0 ? (
                      <ErrorGroupActions fingerprint={group.fingerprint} />
                    ) : null}
                    <Button asChild size="sm" variant="outline">
                      <Link href={errorsHref(filters, { group: group.fingerprint })}>
                        View occurrences
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
