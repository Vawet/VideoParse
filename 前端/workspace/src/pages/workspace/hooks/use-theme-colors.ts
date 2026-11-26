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
  background: "hsl(240 14% 97%)",
  card: "hsl(0 0% 100%)",
  foreground: "hsl(236 18% 12%)",
  mutedForeground: "hsl(237 7% 41%)",
  primary: "hsl(248 58% 51%)",
  primaryForeground: "hsl(0 0% 100%)",
  gold: "hsl(251 47% 45%)",
  soft: "hsl(245 71% 95%)",
  border: "hsl(238 15% 88%)",
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
