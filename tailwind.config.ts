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
        gold: "hsl(var(--gold))",
        ditto: "hsl(var(--ditto))",
        obsidian: "hsl(var(--obsidian))",
        charcoal: "hsl(var(--charcoal))",
        parchment: "hsl(var(--parchment))",
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
      // `body` is 0.875rem because that is what the app actually uses (316 `text-sm`
      // call sites). It was 0.9375rem, which would have nudged nearly every sentence
      // in the product by 1px on adoption for no stated reason.
      //
      // `meta` is floored at 0.75rem on purpose, and is for CHROME only — badges,
      // timestamps, counts, dense cells. It is NOT "smaller subtext": subtext is
      // de-emphasised by colour (`text-muted-foreground`), never by size, which is
      // what stopped one line of helper text rendering at 12px on one card and 14px
      // on the next. Muted foreground is 40% lightness, and at 12px it was carrying
      // disclosure copy and form help.
      fontSize: {
        meta: ["0.75rem", { lineHeight: "1.4" }],
        body: ["0.875rem", { lineHeight: "1.6" }],
        lead: ["1rem", { lineHeight: "1.5" }],
        subhead: ["1.125rem", { lineHeight: "1.4" }],
        head: ["1.5rem", { lineHeight: "1.25" }],
        display: ["2rem", { lineHeight: "1.1" }],
      },
      boxShadow: {
        market:
          "0 1px 2px hsl(var(--obsidian) / 0.08), 0 10px 30px hsl(var(--obsidian) / 0.06)",
        auction: "0 16px 44px hsl(var(--obsidian) / 0.16)",
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
        "listing-marquee": {
          from: { transform: "translate3d(0, 0, 0)" },
          to: { transform: "translate3d(-50%, 0, 0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "listing-marquee": "listing-marquee 60s linear infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
