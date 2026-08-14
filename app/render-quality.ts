export type RenderQuality = "HIGH" | "BALANCED" | "MOBILE";

export type RenderQualityProfile = Readonly<{
  ratioCap: number;
  pixelBudget: number;
  glowRatio: number;
  cityFarDistance: number;
  buildingSpacing: number;
  buildingWindowRows: number;
  buildingWindowColumns: number;
  vehicleCount: number;
  noiseEnabled: boolean;
  minimumFrameIntervalMs: number;
  bloomEnabled: boolean;
}>;

export const RENDER_QUALITY_PROFILES: Readonly<
  Record<RenderQuality, RenderQualityProfile>
> = {
  HIGH: {
    ratioCap: 1.65,
    pixelBudget: 5_200_000,
    glowRatio: 0.5,
    cityFarDistance: 2_800,
    buildingSpacing: 35,
    buildingWindowRows: 30,
    buildingWindowColumns: 9,
    vehicleCount: 20,
    noiseEnabled: true,
    minimumFrameIntervalMs: 0,
    bloomEnabled: true,
  },
  BALANCED: {
    ratioCap: 1.45,
    pixelBudget: 3_600_000,
    glowRatio: 0.5,
    cityFarDistance: 2_800,
    buildingSpacing: 41,
    buildingWindowRows: 30,
    buildingWindowColumns: 9,
    vehicleCount: 20,
    noiseEnabled: true,
    minimumFrameIntervalMs: 0,
    bloomEnabled: true,
  },
  MOBILE: {
    // iPhones frequently expose DPR 3. Rendering a full-screen canvas near
    // that density plus a blurred glow buffer is needlessly expensive for a
    // moving night scene. A deliberately soft backing surface is preferable
    // to uneven frame delivery on thermally constrained mobile Safari.
    ratioCap: 0.7,
    pixelBudget: 420_000,
    glowRatio: 0.16,
    cityFarDistance: 1_650,
    buildingSpacing: 105,
    buildingWindowRows: 3,
    buildingWindowColumns: 2,
    vehicleCount: 6,
    noiseEnabled: false,
    minimumFrameIntervalMs: 0,
    bloomEnabled: false,
  },
} as const;

export function selectRenderQuality(
  width: number,
  coarsePointer: boolean,
): RenderQuality {
  if (coarsePointer || width < 760) return "MOBILE";
  if (width < 1280) return "BALANCED";
  return "HIGH";
}

export function renderPixelRatio(
  width: number,
  height: number,
  devicePixelRatio: number,
  quality: RenderQuality,
): number {
  const profile = RENDER_QUALITY_PROFILES[quality];
  const budgetRatio = Math.sqrt(
    profile.pixelBudget / Math.max(1, width * height),
  );
  return Math.max(
    quality === "MOBILE" ? 0.62 : 0.75,
    Math.min(devicePixelRatio || 1, profile.ratioCap, budgetRatio),
  );
}
