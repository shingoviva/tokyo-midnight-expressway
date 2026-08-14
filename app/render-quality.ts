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
  },
  MOBILE: {
    // iPhones frequently expose DPR 3. Rendering a full-screen canvas near
    // that density plus a blurred glow buffer is needlessly expensive for a
    // moving night scene. One CSS pixel remains crisp at handset distance.
    ratioCap: 1,
    pixelBudget: 1_050_000,
    glowRatio: 0.28,
    cityFarDistance: 2_250,
    buildingSpacing: 62,
    buildingWindowRows: 8,
    buildingWindowColumns: 4,
    vehicleCount: 9,
    noiseEnabled: false,
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
    quality === "MOBILE" ? 0.72 : 0.75,
    Math.min(devicePixelRatio || 1, profile.ratioCap, budgetRatio),
  );
}
