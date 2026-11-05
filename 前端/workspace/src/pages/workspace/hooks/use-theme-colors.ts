import { useEffect, useState } from "react";

/**
 * Resolves the current design tokens to concrete `hsl()` strings.
 * The mind map draws to SVG with inline presentation attributes (so the same
 * markup can be exported to PNG), and it must follow light/dark switching.
 */
export type ThemeColors = {
  background: string;
  card: string;
  foreground: string;
  mutedForeground: string;
  primary: string;
  primaryForeground: string;
  gold: string;
  soft: string;
  border: string;
};

const FALLBACK: ThemeColors = {
  background: "hsl(60 6% 5%)",
  card: "hsl(60 5% 8%)",
  foreground: "hsl(45 24% 93%)",
  mutedForeground: "hsl(45 9% 63%)",
  primary: "hsl(74 90% 62%)",
  primaryForeground: "hsl(60 25% 6%)",
  gold: "hsl(43 62% 62%)",
  soft: "hsl(74 38% 15%)",
  border: "hsl(48 8% 18%)",
};

function read(root: HTMLElement, name: string, fallback: string): string {
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  return raw ? `hsl(${raw})` : fallback;
}

function snapshot(): ThemeColors {
  if (typeof window === "undefined") return FALLBACK;
  const root = document.documentElement;
  return {
    background: read(root, "--background", FALLBACK.background),
    card: read(root, "--card", FALLBACK.card),
    foreground: read(root, "--foreground", FALLBACK.foreground),
    mutedForeground: read(root, "--muted-foreground", FALLBACK.mutedForeground),
    primary: read(root, "--primary", FALLBACK.primary),
    primaryForeground: read(root, "--primary-foreground", FALLBACK.primaryForeground),
    gold: read(root, "--gold", FALLBACK.gold),
    soft: read(root, "--primary-soft", FALLBACK.soft),
    border: read(root, "--border", FALLBACK.border),
  };
}

export function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState<ThemeColors>(snapshot);

  useEffect(() => {
    const observer = new MutationObserver(() => setColors(snapshot()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    setColors(snapshot());
    return () => observer.disconnect();
  }, []);

  return colors;
}
