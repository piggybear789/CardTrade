import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
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
      // THE SCALE CAME DOWN A NOTCH. `body` is 0.8125rem (13px), `subhead` 17px,
      // `head` 21px, `display` 28px — a denser register throughout, with the
      // line-height ratios unchanged so the rhythm scales with it rather than
      // going cramped.
      //
      // TWO LEVELS DID NOT MOVE, and neither is negotiable:
      //
      //   `meta` is floored at 0.75rem. It is for CHROME only — badges,
      //   timestamps, counts, dense cells. It is NOT "smaller subtext": subtext
      //   is de-emphasised by colour (`text-muted-foreground`), never by size.
      //   Muted foreground is 42% lightness, and below 12px it stops being
      //   readable copy and starts being decoration.
      //
      //   `lead` stays at exactly 1rem because `Input`, `Textarea` and
      //   `SelectTrigger` set it on touch. iOS Safari zooms the viewport when a
      //   focused field's text is under 16px, and it does not zoom back out —
      //   the user is left on a magnified page mid-form. Anything below 1rem
      //   here breaks every mobile form in the product. Devices with a precise
      //   pointer step those controls down to `body` via `pointer-fine:`, which
      //   is where the density was actually wanted.
      fontSize: {
        meta: ["0.75rem", { lineHeight: "1.4" }],
        body: ["0.8125rem", { lineHeight: "1.6" }],
        // THE SIDEBAR RAIL ONLY, and deliberately one step above `body`.
        //
        // The rail is eleven navigation targets in a narrow column, read by
        // flicking down a list rather than by reading a sentence — a register
        // where 13px stops being dense and starts being hard to scan. It sits on
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
  plugins: [
    tailwindcssAnimate,
    // `pointer-fine:` — the device's PRIMARY input is precise: mouse, trackpad,
    // stylus. This is the right gate for the 16px field floor, and `sm:` never was.
    //
    // The floor exists for one browser behaviour: iOS Safari zooms the viewport
    // when a focused field's text is under 16px, and it does not zoom back out.
    // That is a property of the INPUT DEVICE, not of how wide the window happens
    // to be, so a width breakpoint got it wrong at both ends — a desktop window
    // dragged under 640px was pushed to 16px it never needed, while an iPad at
    // 900px was handed 13px and zoomed on every field.
    //
    // A touchscreen laptop reports `pointer: fine` with `any-pointer: coarse`, and
    // that is the behaviour we want: desktop browsers do not zoom on focus, so the
    // presence of a touchscreen is irrelevant. Hence `pointer`, not `any-pointer`.
    plugin(({ addVariant }) => {
      addVariant("pointer-fine", "@media (pointer: fine)");
    }),
  ],
};

export default config;
