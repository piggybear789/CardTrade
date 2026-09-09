import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        sm: "1.5rem",
        lg: "2rem",
      },
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        sidebar: "hsl(var(--sidebar))",
        // The signature violet. Non-text use only — rings, borders, markers,
        // icons — because it is 3.73:1 on the page. Use `iris-ink` for text.
        iris: {
          DEFAULT: "hsl(var(--iris))",
          ink: "hsl(var(--iris-ink))",
        },
        action: {
          DEFAULT: "hsl(var(--action))",
          foreground: "hsl(var(--action-foreground))",
          // `border-action-edge`. Named `edge` rather than `border` so the class
          // does not read `border-action-border`.
          edge: "hsl(var(--action-border))",
        },
        obsidian: "hsl(var(--obsidian))",
        mist: "hsl(var(--mist))",
        trust: "hsl(var(--trust))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      fontFamily: {
        // Plus Jakarta Sans for headings, copy, labels, and ledger data.
        // `display` keeps its utility name so existing classnames don't change.
        sans: [
          "var(--font-plus-jakarta)",
          "ui-sans-serif",
          "system-ui",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        display: [
          "var(--font-plus-jakarta)",
          "ui-sans-serif",
          "system-ui",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        // ONE TYPEFACE. `mono` is kept as a NAME so any stray `font-mono` still
        // resolves, but it points at the same Plus Jakarta stack — the app loads no
        // monospace face. Reintroducing one here would put two families back on
        // screen, which is the thing this consolidation removed.
        mono: [
          "var(--font-plus-jakarta)",
          "ui-sans-serif",
          "system-ui",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      // SPACING RHYTHM, named by intent rather than by size.
      //
      // The design system had colour and radius tokens but no spacing scale, so
      // vertical rhythm was picked per component and ran mt-0.5 / 1 / 1.5 / 2 /
      // 2.5 / 3 / 5 / 7 / 9 with no discernible step. Tailwind's numeric scale is
      // still available and still fine for one-offs; these exist so that the four
      // decisions that actually matter — inside a group, between groups, between
      // sections, between regions — are made once and reused.
      //
      // Reach for these when the question is "how far apart do these belong?"
      // rather than "how many pixels?".
      // See `.kiro/specs/design-system/typography-spacing.md` for the mapping rules.
      spacing: {
        tight: "0.25rem", // icon to its label
        snug: "0.5rem", // within one component
        cozy: "0.75rem", // dense rows, nested groups, compact padding
        group: "1rem", // standard card padding; between related components
        section: "2rem", // between sections
        region: "4rem", // between major page regions
      },
      // TYPE SCALE — six levels, and the ONE place a text size is decided.
      // Mapping rules and reasoning: `.kiro/specs/design-system/typography-spacing.md`.
      //
      // These tokens deliberately set size and LINE-HEIGHT ONLY, not weight. Pairing
      // weight with size reads well in a config file and fails in practice: 649 call
      // sites carry their own `font-medium` / `font-semibold` / `font-bold`, and a
      // fontSize utility that also emits `font-weight` collides with them at equal
      // specificity — resolved by CSS source order, which the component author cannot
      // see. Weight stays an explicit utility so every token is a safe drop-in.
      //
      // THE SCALE CAME DOWN A NOTCH. `subhead` 17px, `head` 21px, `display` 28px
      // — a denser register throughout, with the line-height ratios unchanged so
      // the rhythm scales with it rather than going cramped.
      //
      // `body` IS UNDER TEST AT 0.875rem (14px). It shipped at 0.8125rem (13px),
      // which read tight on a phone, so it has been raised one step to be looked
      // at on a device. Two things move with it and are easy to miss:
      //
      //   - Its line box is now 22.4px, not 20.8px. `Skeleton` reserves height
      //     from the type scale, so any hand-computed placeholder height derived
      //     from a `text-body` line has to be recomputed — see the description
      //     field in `ItemFormSkeleton`.
      //   - `nav` is 15px, and its whole justification is being a step above
      //     `body` for the sidebar rail. At 14px that step is one pixel, which is
      //     not a register. If 14px stays, `nav` needs revisiting or retiring.
      //
      // 14px does NOT change the iOS focus-zoom position: the threshold is 16px,
      // so a focused field still zooms. See the `lead` note below.
      //
      // TWO LEVELS DID NOT MOVE, and neither is negotiable:
      //
      //   `meta` is floored at 0.75rem. It is for CHROME only — badges,
      //   timestamps, counts, dense cells. It is NOT "smaller subtext": subtext
      //   is de-emphasised by colour (`text-muted-foreground`), never by size.
      //   Muted foreground is 42% lightness, and below 12px it stops being
      //   readable copy and starts being decoration.
      //
      //   `lead` stays at exactly 1rem, but it is now a TYPE choice and nothing
      //   more — a card title, a thread subject, a page-level empty state. It is
      //   no longer load-bearing for form fields.
      //
      //   It used to be. `Input`, `Textarea` and `SelectTrigger` set it on touch
      //   because iOS Safari zooms the viewport when a focused field's text is
      //   under 16px and does not zoom back out, leaving the member on a
      //   magnified page mid-form. That floor was removed deliberately: the
      //   fields match the labels and body copy around them at `body`, and the
      //   focus-zoom is an accepted tradeoff. Raising `body` to 14px does not
      //   change that — the threshold is 16px, not "close to 16px". The
      //   behaviour is real and still current, so if a mobile form is ever
      //   reported as "jumping on tap", this is the cause and the fix is a 16px
      //   floor scoped to iOS — `@supports (-webkit-touch-callout: none)` — not
      //   a pointer or width query. Do NOT reintroduce it per-component: a floor
      //   on some fields and not others is what left four bare inputs at 16px
      //   while `Input` was already down at `body`.
      fontSize: {
        meta: ["0.75rem", { lineHeight: "1.4" }],
        body: ["0.875rem", { lineHeight: "1.6" }],
        // THE SIDEBAR RAIL ONLY, and deliberately one step above `body`.
        //
        // The rail is eleven navigation targets in a narrow column, read by
        // flicking down a list rather than by reading a sentence — a register
        // where the body size stops being dense and starts being hard to scan.
        // NOTE: that argument was written against a 13px `body` and is weak at
        // 14px, where this token is only one pixel larger. It sits on
        // `--sidebar` too, which is a step darker than the page, so its ink has
        // slightly less contrast to work with than body copy does.
        //
        // Do NOT reach for this anywhere else. It exists so the rail can hold its
        // size independently of the body scale; used in content it would just be
        // an inconsistent paragraph.
        nav: ["0.9375rem", { lineHeight: "1.4" }],
        lead: ["1rem", { lineHeight: "1.5" }],
        subhead: ["1.0625rem", { lineHeight: "1.4" }],
        head: ["1.3125rem", { lineHeight: "1.25" }],
        display: ["1.75rem", { lineHeight: "1.1" }],
      },
      // Tightened to the theme's shadow spec (0 4px 10px at 5%). The previous
      // 30px and 44px blurs paired with a 1px border on the same element,
      // which is the "ghost card" tell — a soft wide bloom doing the job a
      // defined edge already does. Pick one; the border wins.
      boxShadow: {
        market: "0 1px 2px hsl(var(--obsidian) / 0.04), 0 4px 10px hsl(var(--obsidian) / 0.05)",
        auction: "0 6px 16px hsl(var(--obsidian) / 0.10)",
        // Hover elevation for a whole card that is itself a link. Deliberately
        // under a 16px blur: a wide soft bloom paired with a 1px border on the
        // same element is the "ghost card" tell. This is state feedback that
        // only exists on hover, not resting decoration.
        lift: "0 2px 6px hsl(var(--obsidian) / 0.07), 0 8px 14px hsl(var(--obsidian) / 0.10)",
      },
      // Shared content spine for MarketplaceShell's content column and the
      // landing frame. 90rem / 1440px is one extra catalog column over `7xl`
      // without letting listing copy and 50/50 splits sprawl on ultrawide.
      // Chrome (header, rail, mobile hub) stays full-bleed.
      maxWidth: {
        workspace: "90rem",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "dialog-fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "dialog-fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "dialog-fade-in": "dialog-fade-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "dialog-fade-out": "dialog-fade-out 120ms ease-in both",
      },
    },
  },
  // NO `pointer-fine:` VARIANT, and it is not an oversight.
  //
  // It existed for one thing: gating the 16px field floor on the device's primary
  // pointer, because iOS Safari's focus-zoom is a property of the INPUT DEVICE and
  // not of window width — a desktop window dragged under 640px was pushed to 16px
  // it never needed, while an iPad at 900px was handed the body size and zoomed on
  // every field. Correct reasoning, but the floor itself is gone: fields are `body`
  // everywhere now, so the variant had no call sites left.
  //
  // If the focus-zoom ever has to be suppressed again, the gate is NOT this one.
  // `pointer: coarse` also catches Android, which does not zoom, so it would floor
  // devices that need nothing. Scope it to the browser that has the behaviour:
  // `@supports (-webkit-touch-callout: none)`. See the `lead` note above.
  plugins: [tailwindcssAnimate],
};

export default config;
