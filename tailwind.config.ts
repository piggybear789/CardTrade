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
        // Geist pairing: Sans for headings + copy, Mono for labels and ledger
        // data. `display` keeps its utility name so existing classnames don't
        // change.
        sans: [
          "var(--font-geist-sans)",
          "ui-sans-serif",
          "system-ui",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        display: [
          "var(--font-geist-sans)",
          "ui-sans-serif",
          "system-ui",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
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
      spacing: {
        tight: "0.25rem", // icon to its label
        snug: "0.5rem", // within one component
        group: "1rem", // between related components
        section: "2rem", // between sections
        region: "4rem", // between major page regions
      },
      // TYPE SCALE. Five levels with size AND weight/leading paired, so a component
      // picks a level instead of inventing a size. Replaces one-off bracket values
      // like text-[0.8125rem] / text-[0.9375rem] / text-[0.625rem], which had put
      // four distinct undocumented sizes on a single card.
      //
      // `meta` is floored at 0.75rem on purpose: metadata was rendering at 10px in
      // the catalog grid, which is under the size where text stays comfortable —
      // and it was carrying the seller name and rating, the two things a buyer
      // scans before clicking.
      fontSize: {
        meta: ["0.75rem", { lineHeight: "1.4", fontWeight: "400" }],
        body: ["0.9375rem", { lineHeight: "1.6", fontWeight: "400" }],
        subhead: ["1.125rem", { lineHeight: "1.4", fontWeight: "600" }],
        head: ["1.5rem", { lineHeight: "1.25", fontWeight: "600" }],
        display: ["2.5rem", { lineHeight: "1.08", fontWeight: "600" }],
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
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
