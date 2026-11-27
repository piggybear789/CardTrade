// components/ui/icon.tsx
//
// THE ONE WAY THE WEB APP DRAWS AN ICON. Every glyph comes from the registry in
// `components/ui/icons.ts` and renders through `<Icon icon={…} />`, so the icon set is
// one dependency behind two files, not a decision repeated at 190 call sites.
//
// WHY PHOSPHOR (2026-11-28, replacing Hugeicons free). The free Hugeicons set has ONE
// style, a 1.5px stroke on a 24px grid. Almost every icon here renders at 16px, where
// that stroke becomes 1px and lands between device pixels, so the glyphs drew soft and
// grey: the "low-resolution" look. Rendered side by side at 16, 20 and 24px (Phosphor,
// Tabler, Remix, Lucide, Solar; see the audit artifact), Phosphor was the only set with
// both a crisp small weight and a filled twin of every glyph, which is what an
// Instagram-style active state needs. Lucide was ruled out as the shadcn default.
//
// THE WEIGHT FOLLOWS THE SIZE, like an optical size in a typeface. Phosphor's weights
// are drawn on a 256 grid: `regular` is a 16-unit stroke, `bold` 24. Picking by size
// keeps the PHYSICAL line near 1.5px everywhere:
//
//     12px bold 1.1px   14px bold 1.3px   16px bold 1.5px   18px bold 1.7px
//     20px regular 1.25px   24px regular 1.5px   32px regular 2px
//
// Under 20px is `bold`, 20px and up is `regular`. The size is read from the `size-*`
// (or `h-*`) class on the icon, or the `size` prop; an icon with neither is sized by its
// container (a Button or Badge draws `[&_svg]:size-4` / `size-3`), so it takes `bold`.
// `weight="fill"` is the active state of a navigation glyph; pass `weight` only for that
// or for a deliberate exception.
//
// Decorative by default (`aria-hidden`), as every call site already treated it: the
// control or text beside an icon carries the name. Give it `aria-label` (or `alt`) and it
// is announced instead.
import type { IconProps, Icon as PhosphorIcon, IconWeight } from '@phosphor-icons/react/dist/lib/types';

/** A glyph from `components/ui/icons.ts`. Pass it to `<Icon icon={…} />`, never render it bare. */
export type IconGlyph = PhosphorIcon;
export type { IconWeight };

export interface IconComponentProps extends Omit<IconProps, 'weight'> {
  icon: IconGlyph;
  /** Overrides the size-derived weight. `fill` for an active navigation item. */
  weight?: IconWeight;
}

/** Below this rendered size (px) the bold cut is used; at and above it, regular. */
export const ICON_REGULAR_FROM_PX = 20;

// `size-4`, `md:size-5`, `h-3.5`, `size-[18px]`, `size-[1.125rem]`: one token, any variant.
const SIZE_TOKEN = /(?:^|\s)(?:[\w-]+:)*(?:size|h)-(?:(\d+(?:\.\d+)?)|\[(\d*\.?\d+)(px|rem)\])(?=\s|$)/g;

/**
 * The weight an icon of this size should be drawn in. The SMALLEST size named wins, so
 * `size-5 md:size-4` is drawn for 16px, where a thin stroke would cost the most.
 */
export function iconWeightFor(className?: string, size?: string | number): IconWeight {
  const sizes: number[] = [];
  if (typeof size === 'number') sizes.push(size);
  else if (typeof size === 'string' && /^\d+(\.\d+)?(px)?$/.test(size)) sizes.push(Number.parseFloat(size));
  if (className) {
    for (const match of className.matchAll(SIZE_TOKEN)) {
      if (match[1]) sizes.push(Number(match[1]) * 4);
      else if (match[2]) sizes.push(Number(match[2]) * (match[3] === 'rem' ? 16 : 1));
    }
  }
  if (sizes.length === 0) return 'bold';
  return Math.min(...sizes) < ICON_REGULAR_FROM_PX ? 'bold' : 'regular';
}

/**
 * Draw one glyph from the registry at the weight its size calls for.
 *
 * `size` defaults to 24, the width and height ATTRIBUTES the previous set rendered with,
 * so an icon that no class or container sizes keeps its footprint. A `size-*` class or
 * a container's `[&_svg]:size-*` overrides the attributes, as before.
 */
export function Icon({ icon: Glyph, weight, className, size, ...props }: IconComponentProps) {
  const labelled = Boolean(props['aria-label'] || props['aria-labelledby'] || props.alt);
  return (
    <Glyph
      focusable="false"
      {...props}
      weight={weight ?? iconWeightFor(className, size)}
      size={size ?? 24}
      className={className}
      aria-hidden={props['aria-hidden'] ?? (labelled ? undefined : true)}
    />
  );
}
