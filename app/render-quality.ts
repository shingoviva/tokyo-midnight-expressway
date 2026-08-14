export type RenderQuality = "HIGH" | "BALANCED" | "MOBILE";

export const MOBILE_MIN_PIXEL_RATIO = 0.7;
const MOBILE_RATIO_STEP = 0.05;

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
    ratioCap: 0.9,
    pixelBudget: 420_000,
    glowRatio: 0.16,
    cityFarDistance: 1_650,
    buildingSpacing: 92,
    buildingWindowRows: 5,
    buildingWindowColumns: 3,
    vehicleCount: 8,
    noiseEnabled: false,
    // Cap ProMotion displays at 60 rendered frames without penalising normal
    // 60 Hz iPhones. This leaves more thermal headroom for sharper pixels.
    minimumFrameIntervalMs: 1000 / 60,
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
    quality === "MOBILE" ? MOBILE_MIN_PIXEL_RATIO : 0.75,
    Math.min(devicePixelRatio || 1, profile.ratioCap, budgetRatio),
  );
}

export function signMipmapLevel(
  projectedPixelSize: number,
  mipmapCount: number,
): number {
  if (mipmapCount <= 1) return 0;
  // Always downsample from the next larger source. Rounding could select a
  // source smaller than the projected sign, producing crawling edges and an
  // obvious sharpness jump whenever the mip level changed.
  const desiredSourceSize = Math.max(16, Math.min(1024, projectedPixelSize * 2.25));
  return Math.max(
    0,
    Math.min(
      mipmapCount - 1,
      Math.floor(Math.log2(1024 / desiredSourceSize)),
    ),
  );
}

export function adaptiveMobilePixelRatio(
  currentRatio: number,
  ceilingRatio: number,
  smoothedFps: number,
  renderCostMs: number,
  consecutiveHeadroomSamples: number,
): number {
  const ceiling = Math.max(
    MOBILE_MIN_PIXEL_RATIO,
    Math.min(RENDER_QUALITY_PROFILES.MOBILE.ratioCap, ceilingRatio),
  );
  const current = Math.max(
    MOBILE_MIN_PIXEL_RATIO,
    Math.min(ceiling, currentRatio),
  );
  const underPressure = smoothedFps < 52 || renderCostMs > 14;
  const hasSustainedHeadroom =
    consecutiveHeadroomSamples >= 3 &&
    smoothedFps >= 57 &&
    renderCostMs <= 9.5;
  const next = underPressure
    ? current - MOBILE_RATIO_STEP
    : hasSustainedHeadroom
      ? current + MOBILE_RATIO_STEP
      : current;
  return Math.round(
    Math.max(MOBILE_MIN_PIXEL_RATIO, Math.min(ceiling, next)) * 100,
  ) / 100;
}
