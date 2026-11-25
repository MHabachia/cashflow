/** WCAG-Kontrastverhältnis zwischen zwei Farben (1 bis 21). */

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(foreground: string, background: string): number | null {
  const f = parseHex(foreground);
  const b = parseHex(background);
  if (!f || !b) return null;
  const [l1, l2] = [luminance(f), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Weißer Text auf der Akzentfarbe (Buttons): mindestens 4,5 : 1 für normale Schrift. */
export function accentContrastIssue(accentHex: string): string | null {
  const ratio = contrastRatio("#ffffff", accentHex);
  if (ratio === null) return "Ungültiger Farbwert.";
  if (ratio < 3) return `Zu hell: weißer Text auf Buttons ist kaum lesbar (Kontrast ${ratio.toFixed(1)} : 1, nötig sind 4,5 : 1).`;
  if (ratio < 4.5) return `Knapp: Kontrast ${ratio.toFixed(1)} : 1, empfohlen sind mindestens 4,5 : 1.`;
  return null;
}
