// tests/e2e/audit/ux/motion.ts
//
// THE MOTION COLLECTOR: the in-page half of `core/motion.ts` (Req 30.4). It records every
// animation and transition that RAN during a step and describes each as an
// `AnimationDescriptor`: its name, the properties it animates, and the role, classes and
// attribute names of its target and of every ancestor. `classifyAnimation` decides.
//
// `document.getAnimations()` only lists animations that are still running, and an
// entrance or a hover lift is over in a few hundred milliseconds, so reading it once at
// the end of a step would see almost nothing. The init script therefore records:
//
//   * on `animationstart` and `transitionrun` (capture phase, so nothing can stop it),
//     the event target's running animations;
//   * every 150 ms, `document.getAnimations()`, which also catches Web Animations API
//     calls (`element.animate`), which fire no CSS event.
//
// Each (target, name) pair is recorded once per step. The masker's overlay is ignored.

import type { BrowserContext, Page } from '@playwright/test';

import { motionFindings, type AnimationDescriptor } from '../core/motion';
import type { RawObservation } from '../core/uxPolicy';
import { DOM_HELPERS, apiCall, apiGuard, apiPublish, type ObservationWhere } from './pageSnippets';

const API = '__nodittoAuditMotion';

/** Distinct animations remembered per document. */
const MAX_RECORDED = 300;

/** How often the page polls `document.getAnimations()`, in ms. */
const POLL_MS = 150;

/** What `readAnimations` returns for one page. */
export interface AnimationReading {
  /** False when the engine has no `getAnimations()`. */
  supported: boolean;
  animations: AnimationDescriptor[];
}

const PAGE_SCRIPT = String.raw`
(function () {
  if (window.top !== window) return;
  ${apiGuard(API)}
  ${DOM_HELPERS}
  var MAX = ${MAX_RECORDED};
  var supported = typeof document.getAnimations === 'function';
  var recorded = [];
  var keys = {};
  var targetIds = typeof WeakMap === 'function' ? new WeakMap() : null;
  var nextId = 1;

  function idOf(el) {
    if (!targetIds) return __auditDescribe(el);
    var id = targetIds.get(el);
    if (!id) { id = nextId++; targetIds.set(el, id); }
    return id;
  }

  function traits(el) {
    var attrs = [];
    for (var i = 0; i < el.attributes.length; i++) attrs.push(el.attributes[i].name);
    var raw = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
    return {
      role: el.getAttribute('role'),
      classes: raw.trim() ? raw.trim().split(/\s+/) : [],
      attributes: attrs
    };
  }

  function nameOf(anim) {
    if (typeof anim.animationName === 'string') return anim.animationName;
    if (typeof anim.transitionProperty === 'string') return anim.transitionProperty;
    return anim.id || '';
  }

  function propertiesOf(anim) {
    var out = [];
    if (typeof anim.transitionProperty === 'string') out.push(anim.transitionProperty);
    var effect = anim.effect;
    if (effect && typeof effect.getKeyframes === 'function') {
      var frames;
      try { frames = effect.getKeyframes(); } catch (e) { frames = []; }
      for (var f = 0; f < frames.length; f++) {
        for (var key in frames[f]) {
          if (Object.prototype.hasOwnProperty.call(frames[f], key) && out.indexOf(key) === -1) out.push(key);
        }
      }
    }
    return out;
  }

  function record(anim) {
    if (recorded.length >= MAX) return;
    var effect = anim.effect;
    var target = effect && effect.target;
    if (!target || target.nodeType !== 1) return;
    if (__auditIsMaskHost(target)) return;
    var name = nameOf(anim);
    var key = idOf(target) + '|' + name + '|' + (effect.pseudoElement || '');
    if (keys[key]) return;
    keys[key] = true;
    var ancestors = [];
    for (var p = target.parentElement; p; p = p.parentElement) ancestors.push(traits(p));
    recorded.push({ name: name, properties: propertiesOf(anim), target: traits(target), ancestors: ancestors });
  }

  function recordAll(list) {
    for (var i = 0; i < list.length; i++) record(list[i]);
  }

  function onEvent(event) {
    var target = event.target;
    if (!target || typeof target.getAnimations !== 'function') return;
    try { recordAll(target.getAnimations()); } catch (e) { /* detached */ }
  }

  if (supported) {
    document.addEventListener('animationstart', onEvent, true);
    document.addEventListener('transitionrun', onEvent, true);
    setInterval(function () {
      try { recordAll(document.getAnimations()); } catch (e) { /* ignore */ }
    }, ${POLL_MS});
  }

  var api = {
    read: function () {
      if (supported) {
        try { recordAll(document.getAnimations()); } catch (e) { /* ignore */ }
      }
      return { supported: supported, animations: recorded.slice() };
    },
    reset: function () {
      recorded = [];
      keys = {};
    }
  };
  ${apiPublish(API)}
})();`;

/** The init script source. */
export function motionInitScript(): string {
  return PAGE_SCRIPT;
}

/** Installs the motion collector in every page `context` opens from now on. */
export async function installMotionCollector(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: PAGE_SCRIPT });
}

/** The animations that ran on the page since the last reset. */
export async function readAnimations(page: Page): Promise<AnimationReading> {
  const reading = (await page.evaluate(apiCall(API, 'read'))) as AnimationReading | null;
  return reading ?? { supported: false, animations: [] };
}

/** Forgets the animations recorded so far; the DSL calls it as each step starts. */
export async function resetAnimations(page: Page): Promise<void> {
  await page.evaluate(apiCall(API, 'reset', 'undefined'));
}

/** One `motion` observation per decorative animation (Req 30.4). Advisory by default. */
export function motionObservations(reading: AnimationReading, where: ObservationWhere): RawObservation[] {
  return motionFindings(reading.animations).map((finding) => ({ ...finding, member: where.member, url: where.url }));
}
