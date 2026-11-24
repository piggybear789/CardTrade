// tests/e2e/audit/ux/pageSnippets.ts
//
// Plain-JavaScript helpers shared by the in-page UX collectors (`cls.ts`, `skeleton.ts`,
// `motion.ts`, `overflow.ts`). Each collector splices these into its own init script.
//
// They are STRINGS, not TypeScript functions, for the reason `masker.ts` gives: a
// function handed to `addInitScript` or `page.evaluate` is serialised with `toString()`,
// and a loader that injects helpers (esbuild's `__name` under keepNames) leaves a call
// to a function that does not exist in the page. A string runs the same under every
// loader. Keep them ES5-ish and free of anything a page could have overridden.

/** The tag of the Masker's overlay host (`masker.ts`). Collectors ignore it. */
export const MASK_HOST_TAG = 'noditto-audit-mask';

/**
 * Defines `__auditDescribe(el)` (`tag#id.class.class`, at most 6 classes) and
 * `__auditPath(el)` (the child-index path from `document.documentElement`, the
 * `NodeRef.path` of `core/cls.ts`, or null when the element is detached), and
 * `__auditIsMaskHost(node)`. Scoped to the enclosing function.
 */
export const DOM_HELPERS = String.raw`
  function __auditDescribe(el) {
    if (!el || el.nodeType !== 1) return '(text)';
    var tag = el.tagName.toLowerCase();
    var id = el.id ? '#' + el.id : '';
    var raw = typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class')) || '';
    var classes = raw.trim() ? '.' + raw.trim().split(/\s+/).slice(0, 6).join('.') : '';
    return tag + id + classes;
  }
  function __auditPath(el) {
    var root = document.documentElement;
    var path = [];
    var node = el;
    while (node && node !== root) {
      var parent = node.parentElement;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.children, node));
      node = parent;
    }
    return node === root ? path : null;
  }
  function __auditIsMaskHost(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    return !!(el && el.closest && el.closest('${MASK_HOST_TAG}'));
  }
`;

/**
 * Defines the collector API object on `window[name]` once, non-enumerable and frozen,
 * and returns early from the enclosing function when it already exists. Use as the
 * first statement: `${guard('__x')}`.
 */
export function apiGuard(name: string): string {
  return `if (Object.prototype.hasOwnProperty.call(window, ${JSON.stringify(name)})) return;`;
}

/** The statement that publishes `api` under `window[name]`. */
export function apiPublish(name: string): string {
  return `Object.defineProperty(window, ${JSON.stringify(name)}, { value: Object.freeze(api), enumerable: false, configurable: false, writable: false });`;
}

/**
 * An expression that calls `window[name][method]()` and yields `fallback` when the
 * collector is not installed (a page opened before installation, or `about:blank`).
 */
export function apiCall(name: string, method: string, fallback = 'null'): string {
  const ref = `window[${JSON.stringify(name)}]`;
  return `(${ref} ? ${ref}.${method}() : ${fallback})`;
}

/** Where an observation happened: the member label and the page URL, already scrubbed. */
export interface ObservationWhere {
  member: string;
  url: string;
}
