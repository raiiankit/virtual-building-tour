/** Display units. Canonical geometry is always metres; this only affects presentation. */
export const UNITS = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 } as const;
export type Unit = keyof typeof UNITS;

const DP: Record<Unit, number> = { m: 2, cm: 1, mm: 0, ft: 2, in: 1 };

export const isUnit = (u: string | undefined | null): u is Unit => !!u && u in UNITS;

/** Format a metric length in the chosen display unit, e.g. `3.20 m`. */
export const fmtLen = (metres: number, u: Unit): string =>
  `${(metres / UNITS[u]).toFixed(DP[u])} ${u}`;

/** Format an area (m²) in the chosen unit², e.g. `12.4 m²`. */
export function fmtArea(m2: number, u: Unit): string {
  const factor = UNITS[u] * UNITS[u];
  return `${(m2 / factor).toFixed(u === "mm" ? 0 : 1)} ${u}²`;
}

/** Parse a user-entered length in the display unit back to metres. */
export const toMetres = (value: number, u: Unit): number => value * UNITS[u];
