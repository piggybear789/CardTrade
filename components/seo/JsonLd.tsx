// components/seo/JsonLd.tsx
//
// Emits a schema.org graph as a JSON-LD script tag.
//
// This is the only place structured data is serialised, so the escaping below is
// the only place it can be got wrong. Builders live in `lib/seo/structuredData.ts`.

import type { StructuredData } from '@/lib/seo/structuredData';

/**
 * Render one or more schema.org nodes as `application/ld+json`.
 *
 * WHY `dangerouslySetInnerHTML` AND NOT A STRING CHILD. Inside a `<script>` the
 * HTML parser is in raw-text mode and stops at the first `</script...`, so a
 * member-authored description containing that sequence would close the tag early
 * and everything after it would be parsed as markup — stored XSS from a listing
 * description. `JSON.stringify` does not escape `<`, so the escape below does:
 * `\u003c` is a valid JSON string escape that means the same character to any
 * JSON-LD consumer, and with no literal `<` left in the payload neither
 * `</script>` nor `<!--` can terminate the context. This is the approach Next's
 * own JSON-LD guide prescribes.
 *
 * Nothing sensitive may be passed here: a JSON-LD block is public by design and
 * is read by crawlers that never render the page, so it must carry only what is
 * already on the page for an anonymous visitor. In particular, never the
 * provider-verified legal name from `sellerIdentityDisclosure` — that is
 * disclosed to a counterparty on a live contract and to nobody else.
 *
 * @param data a single schema.org node, or an array rendered as one graph
 * @param id   optional DOM id, useful when a page emits several blocks
 */
export function JsonLd({
  data,
  id,
}: {
  data: StructuredData | StructuredData[];
  id?: string;
}) {
  const payload = Array.isArray(data)
    ? { '@context': 'https://schema.org', '@graph': data }
    : data;

  return (
    <script
      id={id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(payload).replace(/</g, '\\u003c'),
      }}
    />
  );
}
