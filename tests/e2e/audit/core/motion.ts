// tests/e2e/audit/core/motion.ts
//
// THE MOTION RULE for the e2e UX audit suite. Pure: no Playwright, no DOM, no I/O. The
// in-page collector (`audit/ux/motion.ts`) reads `document.getAnimations()` during a step
// and describes each animation as plain data (its name, the properties it animates, and
// the role, classes and marker attributes of its target and of every ancestor); this
// module decides whether that animation is functional or decorative.
//
// The rule comes from structure.md ("No decorative motion", 2026-11-23): pages, the
// catalog grid and the editors appear without entrances, staggers or page transitions,
// and nothing lifts, shrinks or zooms on hover or press. What stays is functional: colour
// transitions, spinners, the open and close of dialogs, sheets, menus, popovers and
// tooltips, the sonner toaster (the mandated failure channel), and the References pages'
// own `ref-*` motion.
//
// Requirements:
//   30.4  an element other than a dialog, sheet, menu, popover, tooltip or spinner that
//         runs an entrance, stagger, lift or zoom animation is a UX_Observation
//
// Severity and suppressions are the caller's business (`uxPolicy.ts`); the default class
// for this check is advisory.

/** What the collector knows about one element on the animation's ancestor chain. */
export interface ElementTraits {
  /** The explicit `role` attribute, or null. Radix sheets and popovers render `dialog`. */
  role?: string | null;
  /** The element's class list. */
  classes: readonly string[];
  /** Names of the element's attributes (`data-sonner-toaster`, …); values are not needed. */
  attributes?: readonly string[];
}

/** One running animation or transition, as the collector reports it. */
export interface AnimationDescriptor {
  /** `CSSAnimation.animationName`, `CSSTransition.transitionProperty`, or the Web Animation id. */
  name?: string;
  /**
   * The CSS properties the animation changes, from its keyframes. Either spelling is
   * accepted (`backgroundColor` or `background-color`); keyframe bookkeeping keys
   * (`offset`, `easing`, `composite`, `computedOffset`) are ignored.
   */
  properties: readonly string[];
  /** The animated element. */
  target: ElementTraits;
  /** The target's ancestors, nearest first. Order does not affect the verdict. */
  ancestors: readonly ElementTraits[];
}

/** Why an animation was allowed. */
export type MotionAllowReason =
  | 'overlay'
  | 'toaster'
  | 'popper'
  | 'spinner'
  | 'colour-only'
  | 'references'
  | 'no-motion-properties';

/** The verdict on one animation. */
export type MotionVerdict =
  | { allowed: true; reason: MotionAllowReason }
  | { allowed: false; motionProperties: string[] };

/** One decorative-motion problem. The caller adds member, URL and severity. */
export interface MotionObservation {
  check: 'motion';
  message: string;
  detail?: Record<string, string | number>;
}

/**
 * Roles whose open and close may animate: dialog and alert dialog (Radix sheets and
 * popovers render as `dialog`), menus, the select listbox and tooltips.
 */
export const OVERLAY_ROLES: readonly string[] = [
  'dialog',
  'alertdialog',
  'menu',
  'menubar',
  'listbox',
  'tooltip',
];

/** Marker attributes of the sonner toaster and of its toasts. */
export const TOASTER_ATTRIBUTES: readonly string[] = ['data-sonner-toaster', 'data-sonner-toast'];

/** Marker attribute of the wrapper Radix puts around every popper (popover, tooltip, select). */
export const POPPER_ATTRIBUTES: readonly string[] = ['data-radix-popper-content-wrapper'];

/** The spinner utility class. `animate-pulse` is NOT a spinner: it is a skeleton. */
export const SPINNER_CLASS = 'animate-spin';

/** The spinner role: a live status region (`role=status`), as the design specifies. */
export const SPINNER_ROLE = 'status';

/**
 * The References pages' motion classes (`app/globals.css`). A target carrying one, or
 * inside one (`.ref-enter > *` staggers its children), is allowed, as is any animation
 * whose keyframes are named `ref-*`.
 */
export const REFERENCES_MOTION_CLASSES: readonly string[] = [
  'ref-tile',
  'ref-rise',
  'ref-enter',
  'ref-swap',
  'ref-focus-in',
];

/** The colour properties a transition may animate anywhere (design, "UX checks"). */
export const COLOUR_PROPERTIES: readonly string[] = [
  'color',
  'background-color',
  'border-color',
  'outline-color',
  'fill',
  'stroke',
  'text-decoration-color',
];

/**
 * Border colour longhands. A `transition: border-color` reaches `getAnimations()` as one
 * transition per side, so the longhands count as colour too.
 */
const BORDER_COLOUR_LONGHAND =
  /^border-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end)-color$/;

/** Properties that move, scale, fade or reflow an element: the entrance, lift and zoom set. */
export const MOTION_PROPERTIES: readonly string[] = [
  'transform',
  'translate',
  'scale',
  'rotate',
  'opacity',
  'filter',
  // layout
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'gap',
  'row-gap',
  'column-gap',
  'flex-basis',
  'grid-template-rows',
  'grid-template-columns',
];

/** Keys `KeyframeEffect.getKeyframes()` returns that are not CSS properties. */
const KEYFRAME_BOOKKEEPING = new Set(['offset', 'computedoffset', 'easing', 'composite']);

const MOTION_SET = new Set(MOTION_PROPERTIES);
const COLOUR_SET = new Set(COLOUR_PROPERTIES);

/**
 * Normalises a property name to lower-case kebab case (`backgroundColor` →
 * `background-color`). Custom properties (`--tw-…`) are returned unchanged.
 */
export function normaliseProperty(property: string): string {
  const trimmed = property.trim();
  if (trimmed.startsWith('--')) return trimmed;
  return trimmed.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).toLowerCase();
}

/** True when `property` (either spelling) is a colour property. */
export function isColourProperty(property: string): boolean {
  const name = normaliseProperty(property);
  return COLOUR_SET.has(name) || BORDER_COLOUR_LONGHAND.test(name);
}

/** True when `property` (either spelling) moves, scales, fades or reflows an element. */
export function isMotionProperty(property: string): boolean {
  return MOTION_SET.has(normaliseProperty(property));
}

function cssProperties(properties: readonly string[]): string[] {
  const out = new Set<string>();
  for (const property of properties) {
    const name = normaliseProperty(property);
    if (name === '' || KEYFRAME_BOOKKEEPING.has(name.replace(/-/g, ''))) continue;
    out.add(name);
  }
  return [...out];
}

function hasRole(element: ElementTraits, roles: readonly string[]): boolean {
  const role = element.role?.trim().toLowerCase();
  return role !== undefined && role !== '' && roles.includes(role);
}

function hasAttribute(element: ElementTraits, names: readonly string[]): boolean {
  return (element.attributes ?? []).some((name) => names.includes(name.toLowerCase()));
}

function hasClass(element: ElementTraits, names: readonly string[]): boolean {
  return element.classes.some((name) => names.includes(name));
}

/**
 * Classifies one animation (Req 30.4). It is allowed when, checked in this order:
 *
 * 1. its target or an ancestor is an overlay (`OVERLAY_ROLES`: dialog, alert dialog,
 *    sheet, menu, listbox, popover, tooltip);
 * 2. its target or an ancestor is the sonner toaster or a toast;
 * 3. its target or an ancestor is a Radix popper wrapper;
 * 4. its target is a spinner (`animate-spin`, or `role=status`);
 * 5. it is References motion: keyframes named `ref-*`, or a `ref-*` motion class on the
 *    target or an ancestor;
 * 6. it animates only colour properties;
 * 7. it animates no property in `MOTION_PROPERTIES` (a shadow-only transition, say).
 *
 * Anything else animates transform, translate, scale, rotate, opacity, filter or layout
 * outside every allowed context, and is reported with those properties.
 */
export function classifyAnimation(animation: AnimationDescriptor): MotionVerdict {
  const chain = [animation.target, ...animation.ancestors];
  if (chain.some((element) => hasRole(element, OVERLAY_ROLES))) {
    return { allowed: true, reason: 'overlay' };
  }
  if (chain.some((element) => hasAttribute(element, TOASTER_ATTRIBUTES))) {
    return { allowed: true, reason: 'toaster' };
  }
  if (chain.some((element) => hasAttribute(element, POPPER_ATTRIBUTES))) {
    return { allowed: true, reason: 'popper' };
  }
  if (hasClass(animation.target, [SPINNER_CLASS]) || hasRole(animation.target, [SPINNER_ROLE])) {
    return { allowed: true, reason: 'spinner' };
  }
  if (
    (animation.name ?? '').trim().startsWith('ref-') ||
    chain.some((element) => hasClass(element, REFERENCES_MOTION_CLASSES))
  ) {
    return { allowed: true, reason: 'references' };
  }
  const properties = cssProperties(animation.properties);
  if (properties.length > 0 && properties.every(isColourProperty)) {
    return { allowed: true, reason: 'colour-only' };
  }
  const motionProperties = properties.filter(isMotionProperty).sort();
  if (motionProperties.length === 0) {
    return { allowed: true, reason: 'no-motion-properties' };
  }
  return { allowed: false, motionProperties };
}

function describeTarget(target: ElementTraits): string {
  const role = target.role ? `[role=${target.role}]` : '';
  const classes = target.classes.slice(0, 6).map((name) => `.${name}`).join('');
  return `${role}${classes}` || '(element)';
}

/**
 * Classifies every animation of a step and returns one observation per decorative
 * animation, in input order. An empty array means the step's motion passes.
 */
export function motionFindings(animations: readonly AnimationDescriptor[]): MotionObservation[] {
  const findings: MotionObservation[] = [];
  for (const animation of animations) {
    const verdict = classifyAnimation(animation);
    if (verdict.allowed) continue;
    const name = animation.name?.trim() || '(unnamed)';
    findings.push({
      check: 'motion',
      message:
        `Decorative motion: "${name}" animates ${verdict.motionProperties.join(', ')} on ` +
        `${describeTarget(animation.target)}, outside any dialog, sheet, menu, popover, ` +
        'tooltip, toast or spinner.',
      detail: {
        animation: name,
        properties: verdict.motionProperties.join(','),
        target: describeTarget(animation.target),
      },
    });
  }
  return findings;
}
