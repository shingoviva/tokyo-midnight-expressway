export type OverpassLayoutQuality = "MOBILE" | "BALANCED" | "HIGH";

const PIER_LAYOUTS: ReadonlyArray<
  Readonly<Record<OverpassLayoutQuality, readonly number[]>>
> = [
  {
    MOBILE: [-29, -11.5, 11.5, 29],
    BALANCED: [-47.5, -29, -11.5, 11.5, 29, 47.5],
    HIGH: [-66, -47.5, -29, -11.5, 11.5, 29, 47.5, 66],
  },
  {
    MOBILE: [-32, -12.5, 12.5, 32],
    BALANCED: [-52, -32, -12.5, 12.5, 32, 52],
    HIGH: [-72, -52, -32, -12.5, 12.5, 32, 52, 72],
  },
  {
    MOBILE: [-34, -13.5, 13.5, 34],
    BALANCED: [-55, -34, -13.5, 13.5, 34, 55],
    HIGH: [-76, -55, -34, -13.5, 13.5, 34, 55, 76],
  },
] as const;

/**
 * Returns a stable, allocation-free support layout for transverse highways.
 * The central span remains clear of the main carriageway while outer piers
 * shorten each structural bay to a plausible urban viaduct length.
 */
export function transverseOverpassPierLaterals(
  level: number,
  quality: OverpassLayoutQuality,
): readonly number[] {
  const normalizedLevel = Math.max(0, Math.min(2, Math.round(level)));
  return PIER_LAYOUTS[normalizedLevel]?.[quality] ?? PIER_LAYOUTS[0].HIGH;
}
