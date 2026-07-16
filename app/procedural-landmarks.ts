export type ProceduralLandmarkQuality = "HIGH" | "BALANCED" | "MOBILE";

export type LandmarkDrawContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

export type LandmarkProjection = Readonly<{
  x: number;
  y: number;
  groundY: number;
  scale: number;
}>;

export type ProceduralLandmarkOptions = Readonly<{
  totalDistanceMeters: number;
  sceneLength: number;
  cssWidth: number;
  cssHeight: number;
  quality: ProceduralLandmarkQuality;
  project: (
    z: number,
    lateral: number,
    objectHeight: number,
  ) => LandmarkProjection;
  glowDot: (
    x: number,
    y: number,
    radius: number,
    innerColor: string,
    outerColor?: string,
  ) => void;
}>;

type ScreenPoint = Readonly<{ x: number; y: number }>;

export type ProceduralLandmarkKind =
  | "tokyo-tower"
  | "skytree"
  | "tokyo-metropolitan-government"
  | "toranomon-hills"
  | "shibuya-scramble-square"
  | "cocoon-tower"
  | "fuji-television"
  | "rainbow-bridge"
  | "big-sight"
  | "harbor-cranes";

type LandmarkSpec = Readonly<{
  kind: ProceduralLandmarkKind;
  phase: number;
  lateral: number;
  salt: number;
  maximumDistance: number;
  recurrenceEvery: 3 | 4;
  recurrenceOffset: number;
}>;

type LandmarkMetricProfile = Readonly<{
  widthScale: number;
  depthScale: number;
  lineScale: number;
}>;

export type ProceduralLandmarkInstance = Readonly<{
  kind: ProceduralLandmarkKind;
  z: number;
  lateral: number;
  block: number;
  alpha: number;
}>;

export type ProceduralLandmarkSite = Readonly<{
  kind: ProceduralLandmarkKind;
  world: number;
  lateral: number;
  block: number;
}>;

const TAU = Math.PI * 2;
const LANDMARK_NEAR_CLIP = 0.12;
const RAINBOW_BRIDGE_NEAR_APPROACH = -174;
const RAINBOW_BRIDGE_FAR_APPROACH = 744;
const RAINBOW_BRIDGE_ENTRY_RUNOUT = -360;
const RAINBOW_BRIDGE_EXIT_RUNOUT = 1_040;

export function rainbowBridgeHasVisibleRunout(anchorZ: number): boolean {
  return anchorZ + RAINBOW_BRIDGE_EXIT_RUNOUT > LANDMARK_NEAR_CLIP;
}

export function rainbowBridgeRenderDepth(anchorZ: number): number {
  return rainbowBridgeHasVisibleRunout(anchorZ)
    ? Math.max(LANDMARK_NEAR_CLIP, anchorZ)
    : anchorZ;
}

const LANDMARK_SPECS: readonly LandmarkSpec[] = [
  {
    kind: "tokyo-metropolitan-government",
    phase: 0.115,
    lateral: 118,
    salt: 139,
    maximumDistance: 22000,
    recurrenceEvery: 3,
    recurrenceOffset: 2,
  },
  {
    kind: "cocoon-tower",
    phase: 0.19,
    lateral: 92,
    salt: 157,
    maximumDistance: 30000,
    recurrenceEvery: 4,
    recurrenceOffset: 0,
  },
  {
    kind: "skytree",
    phase: 0.25,
    lateral: 122,
    salt: 211,
    maximumDistance: 30000,
    recurrenceEvery: 4,
    recurrenceOffset: 2,
  },
  {
    kind: "tokyo-tower",
    phase: 0.321,
    lateral: 88,
    salt: 617,
    maximumDistance: 30000,
    recurrenceEvery: 4,
    recurrenceOffset: 0,
  },
  {
    kind: "toranomon-hills",
    phase: 0.495,
    lateral: 96,
    salt: 271,
    maximumDistance: 22000,
    recurrenceEvery: 3,
    recurrenceOffset: 0,
  },
  {
    kind: "big-sight",
    phase: 0.604,
    lateral: 94,
    salt: 419,
    maximumDistance: 12000,
    recurrenceEvery: 3,
    recurrenceOffset: 0,
  },
  {
    kind: "rainbow-bridge",
    phase: 0.679,
    lateral: 10,
    salt: 307,
    maximumDistance: 12000,
    recurrenceEvery: 4,
    recurrenceOffset: 1,
  },
  {
    kind: "harbor-cranes",
    phase: 0.75,
    lateral: 180,
    salt: 503,
    maximumDistance: 12000,
    recurrenceEvery: 3,
    recurrenceOffset: 1,
  },
  {
    kind: "shibuya-scramble-square",
    phase: 0.89,
    lateral: 84,
    salt: 557,
    maximumDistance: 22000,
    recurrenceEvery: 3,
    recurrenceOffset: 1,
  },
  {
    kind: "fuji-television",
    phase: 0.965,
    lateral: 160,
    salt: 683,
    maximumDistance: 18000,
    recurrenceEvery: 4,
    recurrenceOffset: 3,
  },
] as const;

// The geometry below was authored in compact design units. These profiles map
// it into meter-scale silhouettes while preserving the recognizable shapes.
const LANDMARK_METRIC_PROFILES: Readonly<
  Record<ProceduralLandmarkKind, LandmarkMetricProfile>
> = {
  "tokyo-tower": {
    // 42 design units across the base become approximately 95 meters.
    widthScale: 95 / 42,
    depthScale: 1.8,
    lineScale: 1.9,
  },
  skytree: {
    // The triangular footing is approximately 68 meters across.
    widthScale: 68 / 38,
    depthScale: 1,
    lineScale: 1.75,
  },
  "tokyo-metropolitan-government": {
    widthScale: 1,
    depthScale: 1,
    lineScale: 1.2,
  },
  "toranomon-hills": {
    widthScale: 1,
    depthScale: 1,
    lineScale: 1.15,
  },
  "shibuya-scramble-square": {
    widthScale: 1,
    depthScale: 1,
    lineScale: 1.16,
  },
  "cocoon-tower": {
    widthScale: 1,
    depthScale: 1,
    lineScale: 1.12,
  },
  "fuji-television": {
    widthScale: 1,
    depthScale: 1,
    lineScale: 1.08,
  },
  "rainbow-bridge": {
    // The modeled deck becomes roughly 29 meters wide.
    widthScale: 29 / 17.6,
    depthScale: 1,
    lineScale: 1.55,
  },
  "big-sight": {
    widthScale: 1,
    depthScale: 1,
    lineScale: 1.08,
  },
  "harbor-cranes": {
    widthScale: 1.55,
    depthScale: 1.2,
    lineScale: 1.5,
  },
};

// Tokyo's expressways frequently run above the surrounding street, canal and
// waterfront grade. Selected landmarks therefore sit below the camera road
// surface instead of sharing its projected ground plane.
const LANDMARK_TERRAIN_DROP_METERS: Readonly<
  Record<ProceduralLandmarkKind, number>
> = {
  "tokyo-tower": 14,
  skytree: 22,
  "tokyo-metropolitan-government": 8,
  "toranomon-hills": 0,
  "shibuya-scramble-square": 0,
  "cocoon-tower": 7,
  "fuji-television": 18,
  "rainbow-bridge": 0,
  "big-sight": 12,
  "harbor-cranes": 25,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hashInteger(value: number): number {
  let n = value | 0;
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}

function seeded(index: number, salt = 0): number {
  return hashInteger(Math.imul(index, 0x1f123bb5) + salt) / 4294967295;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function proceduralLandmarkTerrainDropMeters(
  kind: ProceduralLandmarkKind,
  block: number,
): number {
  const baseDrop = LANDMARK_TERRAIN_DROP_METERS[kind];
  if (baseDrop <= 0) return 0;
  return baseDrop * (0.82 + seeded(block, 701 + baseDrop * 113) * 0.36);
}

function landmarkOccursInBlock(spec: LandmarkSpec, block: number): boolean {
  return (
    positiveModulo(block, spec.recurrenceEvery) === spec.recurrenceOffset
  );
}

function landmarkSite(
  spec: LandmarkSpec,
  block: number,
  sceneLength: number,
): ProceduralLandmarkSite {
  const side = (hashInteger(block + spec.salt) & 1) === 0 ? -1 : 1;
  const jitter = (seeded(block, spec.salt + 17) - 0.5) * 18;
  return {
    kind: spec.kind,
    world: block * sceneLength + sceneLength * spec.phase,
    lateral: spec.kind === "rainbow-bridge"
      ? jitter * 0.12
      : side * (spec.lateral + jitter),
    block,
  };
}

export function collectProceduralLandmarkSites(
  sceneLengthInput: number,
  minimumWorld: number,
  maximumWorld: number,
): ProceduralLandmarkSite[] {
  if (
    !Number.isFinite(sceneLengthInput) ||
    !Number.isFinite(minimumWorld) ||
    !Number.isFinite(maximumWorld) ||
    maximumWorld < minimumWorld
  ) {
    return [];
  }
  const sceneLength = Math.max(2400, sceneLengthInput);
  const sites: ProceduralLandmarkSite[] = [];
  for (const spec of LANDMARK_SPECS) {
    const anchor = sceneLength * spec.phase;
    const firstBlock = Math.floor((minimumWorld - anchor) / sceneLength) - 1;
    const lastBlock = Math.ceil((maximumWorld - anchor) / sceneLength) + 1;
    for (let block = firstBlock; block <= lastBlock; block += 1) {
      if (!landmarkOccursInBlock(spec, block)) continue;
      const site = landmarkSite(spec, block, sceneLength);
      if (site.world < minimumWorld || site.world > maximumWorld) continue;
      sites.push(site);
    }
  }
  return sites;
}

function rgba(red: number, green: number, blue: number, alpha: number): string {
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
}

function fillPolygon(
  context: LandmarkDrawContext,
  points: ReadonlyArray<ScreenPoint>,
): void {
  if (points.length < 3) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
  context.fill();
}

function strokePolyline(
  context: LandmarkDrawContext,
  points: ReadonlyArray<ScreenPoint>,
): void {
  if (points.length < 2) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.stroke();
}

function projectedRectangle(
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
  left: number,
  right: number,
  bottom: number,
  top: number,
  zOffset = 0,
): ScreenPoint[] {
  return [
    projectedPoint(options, instance, left, bottom, zOffset),
    projectedPoint(options, instance, left, top, zOffset),
    projectedPoint(options, instance, right, top, zOffset),
    projectedPoint(options, instance, right, bottom, zOffset),
  ];
}

function metricHeight(
  kind: ProceduralLandmarkKind,
  designHeight: number,
): number {
  if (kind === "tokyo-tower") {
    // Main deck 150m, upper deck 250m, antenna tip 333m.
    if (designHeight <= 62) return (designHeight / 62) * 150;
    if (designHeight <= 105) {
      return 150 + ((designHeight - 62) / 43) * 100;
    }
    return 250 + ((designHeight - 105) / 65) * 83;
  }
  if (kind === "skytree") {
    // Tembo Deck 350m, Tembo Galleria 450m, antenna tip 634m.
    if (designHeight <= 116) return (designHeight / 116) * 350;
    if (designHeight <= 144) {
      return 350 + ((designHeight - 116) / 28) * 100;
    }
    return 450 + ((designHeight - 144) / 72) * 184;
  }
  if (kind === "rainbow-bridge") return (designHeight / 58) * 127;
  if (kind === "big-sight") return (designHeight / 50) * 58;
  if (kind === "harbor-cranes") {
    // Tokyo Port's container cranes are roughly 58-65m tall.
    return (designHeight / 59) * 62;
  }
  // New tower geometry is authored directly in real-world meters.
  return designHeight;
}

function projectedScaleAt(
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
  zOffset = 0,
): number {
  const profile = LANDMARK_METRIC_PROFILES[instance.kind];
  return (
    options.project(
      instance.z + zOffset * profile.depthScale,
      instance.lateral,
      0,
    ).scale * profile.lineScale
  );
}

function projectedPoint(
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
  lateralOffset: number,
  height: number,
  zOffset = 0,
): ScreenPoint {
  const profile = LANDMARK_METRIC_PROFILES[instance.kind];
  const point = options.project(
    instance.z + zOffset * profile.depthScale,
    instance.lateral + lateralOffset * profile.widthScale,
    metricHeight(instance.kind, height) -
      proceduralLandmarkTerrainDropMeters(instance.kind, instance.block),
  );
  return { x: point.x, y: point.y };
}

function projectedScale(
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
): number {
  return projectedScaleAt(options, instance);
}

function projectedHeight(
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
  height: number,
): number {
  const base = projectedPoint(options, instance, 0, 0);
  const top = projectedPoint(options, instance, 0, height);
  return Math.abs(base.y - top.y);
}

function detailLevel(
  quality: ProceduralLandmarkQuality,
  mobile: number,
  balanced: number,
  high: number,
): number {
  if (quality === "HIGH") return high;
  if (quality === "BALANCED") return balanced;
  return mobile;
}

function landmarkLightRetention(z: number, maximumDistance: number): number {
  const dimmingStart = Math.min(5200, maximumDistance * 0.3);
  return lerp(
    0.02,
    1,
    1 - smoothstep(dimmingStart, maximumDistance, Math.max(0, z)),
  );
}

export function collectProceduralLandmarks(
  options: ProceduralLandmarkOptions,
): ProceduralLandmarkInstance[] {
  const instances: ProceduralLandmarkInstance[] = [];
  const sceneLength = Math.max(2400, options.sceneLength);

  for (const spec of LANDMARK_SPECS) {
    const anchor = sceneLength * spec.phase;
    // A longitudinal bridge remains visible after its near tower passes the
    // camera because most of the 918 m suspension structure is still ahead.
    const minimumZ = spec.kind === "rainbow-bridge"
      ? -RAINBOW_BRIDGE_EXIT_RUNOUT + LANDMARK_NEAR_CLIP
      : LANDMARK_NEAR_CLIP;
    const firstBlock = Math.floor(
      (options.totalDistanceMeters + minimumZ - anchor) / sceneLength,
    );
    const lastBlock = Math.ceil(
      (options.totalDistanceMeters + spec.maximumDistance - anchor) / sceneLength,
    );

    for (let block = firstBlock; block <= lastBlock; block += 1) {
      if (!landmarkOccursInBlock(spec, block)) continue;
      const site = landmarkSite(spec, block, sceneLength);
      const z = site.world - options.totalDistanceMeters;
      if (z <= minimumZ || z >= spec.maximumDistance) continue;
      instances.push({
        kind: spec.kind,
        z,
        lateral: site.lateral,
        block,
        // `alpha` controls emitted light and distance toning, not the opacity
        // of the architectural mass. Landmark bodies remain solid silhouettes.
        alpha: landmarkLightRetention(z, spec.maximumDistance),
      });
    }
  }

  instances.sort((first, second) => second.z - first.z);
  return instances;
}

function isPotentiallyVisible(
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
  heightMeters: number,
  halfWidthMeters: number,
): boolean {
  const base = projectedPoint(options, instance, 0, 0);
  const top = projectedPoint(options, instance, 0, heightMeters);
  const profile = LANDMARK_METRIC_PROFILES[instance.kind];
  const halfWidth =
    halfWidthMeters *
    profile.widthScale *
    options.project(instance.z, instance.lateral, 0).scale;
  const margin = Math.max(80, halfWidth * 0.3);
  return (
    Math.abs(base.y - top.y) >= 2.2 &&
    base.x + halfWidth >= -margin &&
    base.x - halfWidth <= options.cssWidth + margin &&
    top.y <= options.cssHeight + margin &&
    base.y >= -margin
  );
}

function towerHalfWidth(height: number): number {
  if (height <= 63) return lerp(20.5, 6.6, height / 63);
  if (height <= 112) return lerp(6.6, 2.5, (height - 63) / 49);
  return lerp(2.5, 0.9, clamp((height - 112) / 24, 0, 1));
}

function drawTokyoTower(
  context: LandmarkDrawContext,
  glow: LandmarkDrawContext,
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
): void {
  const totalHeight = 170;
  if (!isPotentiallyVisible(options, instance, totalHeight, 21)) return;

  const scale = projectedScale(options, instance);
  const heightPixels = projectedHeight(options, instance, totalHeight);
  const detailAlpha = smoothstep(34, 108, heightPixels);
  const fineAlpha = smoothstep(76, 190, heightPixels);
  const landmarkAlpha = context.globalAlpha;
  const glowAlpha = glow.globalAlpha * instance.alpha;

  context.save();
  context.globalAlpha = landmarkAlpha;
  context.lineCap = "round";
  context.lineJoin = "round";

  context.fillStyle = "#111719";
  fillPolygon(context, [
    projectedPoint(options, instance, -21, 0),
    projectedPoint(options, instance, -18, 8),
    projectedPoint(options, instance, 18, 8),
    projectedPoint(options, instance, 21, 0),
  ]);
  context.fillStyle = "rgba(56, 65, 65, 0.84)";
  fillPolygon(context, [
    projectedPoint(options, instance, -17.5, 8),
    projectedPoint(options, instance, -14, 12),
    projectedPoint(options, instance, 14, 12),
    projectedPoint(options, instance, 17.5, 8),
  ]);

  const drawLeg = (
    side: -1 | 1,
    zOffset: number,
    color: string,
    widthFactor: number,
  ): void => {
    const outerBottom = side * towerHalfWidth(8);
    const outerTop = side * towerHalfWidth(116);
    const bottomThickness = 2.7 * widthFactor;
    const topThickness = 0.85 * widthFactor;
    context.fillStyle = color;
    fillPolygon(context, [
      projectedPoint(options, instance, outerBottom, 7, zOffset),
      projectedPoint(options, instance, outerTop, 118, zOffset),
      projectedPoint(
        options,
        instance,
        outerTop - side * topThickness,
        118,
        zOffset,
      ),
      projectedPoint(
        options,
        instance,
        outerBottom - side * bottomThickness,
        7,
        zOffset,
      ),
    ]);
  };

  drawLeg(-1, 4.4, "rgba(116, 43, 28, 0.8)", 0.88);
  drawLeg(1, 4.4, "rgba(111, 38, 27, 0.78)", 0.88);
  drawLeg(-1, 0, "rgba(220, 72, 34, 0.96)", 1);
  drawLeg(1, 0, "rgba(231, 78, 34, 0.96)", 1);

  context.globalAlpha = landmarkAlpha * detailAlpha;
  context.strokeStyle = "rgba(244, 129, 69, 0.9)";
  context.lineWidth = clamp(scale * 0.34, 0.5, 3.6);
  const braceCount = detailLevel(options.quality, 7, 11, 16);
  const braceBottom = 12;
  const braceTop = 116;
  for (let index = 0; index < braceCount; index += 1) {
    const h0 = lerp(braceBottom, braceTop, index / braceCount);
    const h1 = lerp(braceBottom, braceTop, (index + 1) / braceCount);
    const left0 = -towerHalfWidth(h0) + 0.8;
    const right0 = towerHalfWidth(h0) - 0.8;
    const left1 = -towerHalfWidth(h1) + 0.6;
    const right1 = towerHalfWidth(h1) - 0.6;
    strokePolyline(context, [
      projectedPoint(options, instance, left0, h0),
      projectedPoint(options, instance, right1, h1),
    ]);
    strokePolyline(context, [
      projectedPoint(options, instance, right0, h0),
      projectedPoint(options, instance, left1, h1),
    ]);
    if (index % 2 === 0 || options.quality === "HIGH") {
      strokePolyline(context, [
        projectedPoint(options, instance, left0, h0),
        projectedPoint(options, instance, right0, h0),
      ]);
    }
  }

  const drawDeck = (
    height: number,
    halfWidth: number,
    deckHeight: number,
  ): void => {
    context.globalAlpha = landmarkAlpha;
    context.fillStyle = "rgba(203, 87, 43, 0.98)";
    fillPolygon(context, [
      projectedPoint(options, instance, -halfWidth * 0.82, height),
      projectedPoint(options, instance, -halfWidth, height + deckHeight * 0.42),
      projectedPoint(options, instance, -halfWidth * 0.78, height + deckHeight),
      projectedPoint(options, instance, halfWidth * 0.78, height + deckHeight),
      projectedPoint(options, instance, halfWidth, height + deckHeight * 0.42),
      projectedPoint(options, instance, halfWidth * 0.82, height),
    ]);
    context.fillStyle = "rgba(255, 199, 108, 0.86)";
    fillPolygon(context, [
      projectedPoint(options, instance, -halfWidth * 0.76, height + deckHeight * 0.38),
      projectedPoint(options, instance, halfWidth * 0.76, height + deckHeight * 0.38),
      projectedPoint(options, instance, halfWidth * 0.7, height + deckHeight * 0.62),
      projectedPoint(options, instance, -halfWidth * 0.7, height + deckHeight * 0.62),
    ]);
  };

  drawDeck(62, 6.8, 6.7);
  drawDeck(105, 4.4, 4.2);

  context.globalAlpha = landmarkAlpha;
  const mastSegments = [
    { from: 114, to: 130, color: "#e96232", width: 1.55 },
    { from: 130, to: 141, color: "#e8ded1", width: 1.16 },
    { from: 141, to: 153, color: "#e9562f", width: 0.88 },
    { from: 153, to: 163, color: "#e7ded4", width: 0.58 },
    { from: 163, to: 170, color: "#e54b2b", width: 0.32 },
  ] as const;
  for (const segment of mastSegments) {
    context.strokeStyle = segment.color;
    context.lineWidth = clamp(scale * segment.width, 0.7, 6.5);
    strokePolyline(context, [
      projectedPoint(options, instance, 0, segment.from),
      projectedPoint(options, instance, 0, segment.to),
    ]);
  }

  context.globalAlpha = landmarkAlpha * fineAlpha;
  context.fillStyle = "rgba(248, 198, 116, 0.92)";
  const lampLevels = [25, 40, 79, 92, 126, 145];
  for (const height of lampLevels) {
    const halfWidth = Math.max(0.8, towerHalfWidth(Math.min(height, 116)) * 0.72);
    const left = projectedPoint(options, instance, -halfWidth, height);
    const right = projectedPoint(options, instance, halfWidth, height);
    const radius = clamp(scale * 0.42, 0.65, 2.2);
    context.beginPath();
    context.arc(left.x, left.y, radius, 0, TAU);
    context.arc(right.x, right.y, radius, 0, TAU);
    context.fill();
  }
  context.restore();

  glow.save();
  glow.globalAlpha = glowAlpha * (0.34 + detailAlpha * 0.34);
  glow.strokeStyle = "rgba(255, 73, 28, 0.3)";
  glow.lineWidth = clamp(scale * 2.4, 2.5, 18);
  strokePolyline(glow, [
    projectedPoint(options, instance, -towerHalfWidth(8), 7),
    projectedPoint(options, instance, -towerHalfWidth(115), 115),
    projectedPoint(options, instance, 0, 170),
    projectedPoint(options, instance, towerHalfWidth(115), 115),
    projectedPoint(options, instance, towerHalfWidth(8), 7),
  ]);
  glow.restore();

  const mastTop = projectedPoint(options, instance, 0, 170);
  const mainDeck = projectedPoint(options, instance, 0, 66);
  options.glowDot(
    mainDeck.x,
    mainDeck.y,
    clamp(heightPixels * 0.16, 8, 72),
    rgba(255, 98, 35, instance.alpha * 0.19),
  );
  options.glowDot(
    mastTop.x,
    mastTop.y,
    clamp(scale * 4.2, 3, 21),
    rgba(255, 39, 23, instance.alpha * 0.56),
  );
}

function drawSkytree(
  context: LandmarkDrawContext,
  glow: LandmarkDrawContext,
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
): void {
  const totalHeight = 216;
  if (!isPotentiallyVisible(options, instance, totalHeight, 22)) return;

  const scale = projectedScale(options, instance);
  const heightPixels = projectedHeight(options, instance, totalHeight);
  const detailAlpha = smoothstep(42, 124, heightPixels);
  const fineAlpha = smoothstep(88, 210, heightPixels);
  const landmarkAlpha = context.globalAlpha;
  const glowAlpha = glow.globalAlpha * instance.alpha;

  const halfWidthAt = (height: number): number => {
    if (height < 112) return lerp(19, 6.2, height / 112);
    if (height < 151) return lerp(6.2, 3.2, (height - 112) / 39);
    return lerp(2.1, 0.3, clamp((height - 151) / 65, 0, 1));
  };

  context.save();
  context.globalAlpha = landmarkAlpha;
  context.lineCap = "round";
  context.lineJoin = "round";

  const bodyGradient = context.createLinearGradient(
    0,
    projectedPoint(options, instance, 0, totalHeight).y,
    0,
    projectedPoint(options, instance, 0, 0).y,
  );
  bodyGradient.addColorStop(0, "rgba(184, 208, 216, 0.84)");
  bodyGradient.addColorStop(0.55, "rgba(103, 137, 151, 0.86)");
  bodyGradient.addColorStop(1, "rgba(42, 64, 73, 0.92)");
  context.fillStyle = bodyGradient;
  fillPolygon(context, [
    projectedPoint(options, instance, -19, 0),
    projectedPoint(options, instance, -3.1, 151),
    projectedPoint(options, instance, 3.1, 151),
    projectedPoint(options, instance, 19, 0),
  ]);

  context.globalAlpha = landmarkAlpha * detailAlpha;
  context.strokeStyle = "rgba(209, 230, 235, 0.84)";
  context.lineWidth = clamp(scale * 0.38, 0.5, 3.4);
  const latticeCount = detailLevel(options.quality, 7, 12, 17);
  for (let index = 0; index < latticeCount; index += 1) {
    const h0 = lerp(4, 148, index / latticeCount);
    const h1 = lerp(4, 148, (index + 1) / latticeCount);
    const left0 = -halfWidthAt(h0) + 0.7;
    const right0 = halfWidthAt(h0) - 0.7;
    const left1 = -halfWidthAt(h1) + 0.45;
    const right1 = halfWidthAt(h1) - 0.45;
    strokePolyline(context, [
      projectedPoint(options, instance, left0, h0),
      projectedPoint(options, instance, right1, h1),
    ]);
    strokePolyline(context, [
      projectedPoint(options, instance, right0, h0),
      projectedPoint(options, instance, left1, h1),
    ]);
    if (index % 2 === 0) {
      strokePolyline(context, [
        projectedPoint(options, instance, left0, h0),
        projectedPoint(options, instance, right0, h0),
      ]);
    }
  }

  context.strokeStyle = "rgba(113, 182, 205, 0.68)";
  context.lineWidth = clamp(scale * 0.7, 0.8, 5.5);
  strokePolyline(context, [
    projectedPoint(options, instance, -17.2, 0),
    projectedPoint(options, instance, 0, 150),
    projectedPoint(options, instance, 17.2, 0),
  ]);

  const drawObservationDeck = (
    height: number,
    radiusMeters: number,
    deckHeightMeters: number,
  ): void => {
    const center = projectedPoint(options, instance, 0, height);
    context.globalAlpha = landmarkAlpha;
    context.fillStyle = "rgba(44, 67, 77, 0.98)";
    context.beginPath();
    context.ellipse(
      center.x,
      center.y,
      Math.max(1, radiusMeters * scale),
      Math.max(0.8, deckHeightMeters * scale),
      0,
      0,
      TAU,
    );
    context.fill();
    context.globalAlpha = landmarkAlpha * detailAlpha;
    context.strokeStyle = "rgba(184, 232, 245, 0.92)";
    context.lineWidth = clamp(scale * 0.55, 0.7, 3.2);
    context.stroke();
    context.strokeStyle = "rgba(91, 207, 235, 0.8)";
    context.lineWidth = clamp(scale * 0.2, 0.5, 1.6);
    context.beginPath();
    context.ellipse(
      center.x,
      center.y - deckHeightMeters * scale * 0.2,
      Math.max(1, radiusMeters * scale * 0.9),
      Math.max(0.5, deckHeightMeters * scale * 0.43),
      0,
      0,
      TAU,
    );
    context.stroke();
  };

  drawObservationDeck(116, 14, 5.5);
  drawObservationDeck(144, 10.5, 4.5);

  context.globalAlpha = landmarkAlpha;
  context.strokeStyle = "rgba(211, 225, 226, 0.96)";
  context.lineWidth = clamp(scale * 1.3, 0.8, 5.4);
  strokePolyline(context, [
    projectedPoint(options, instance, 0, 148),
    projectedPoint(options, instance, 0, 216),
  ]);
  context.globalAlpha = landmarkAlpha * fineAlpha;
  context.strokeStyle = "rgba(100, 217, 242, 0.88)";
  context.lineWidth = clamp(scale * 0.34, 0.5, 2.2);
  for (let height = 155; height < 210; height += 7.5) {
    strokePolyline(context, [
      projectedPoint(options, instance, -halfWidthAt(height), height),
      projectedPoint(options, instance, halfWidthAt(height), height),
    ]);
  }
  context.restore();

  glow.save();
  glow.globalAlpha = glowAlpha * 0.5;
  glow.strokeStyle = "rgba(73, 187, 222, 0.28)";
  glow.lineWidth = clamp(scale * 2.8, 3, 20);
  strokePolyline(glow, [
    projectedPoint(options, instance, -18, 0),
    projectedPoint(options, instance, 0, 151),
    projectedPoint(options, instance, 0, 216),
    projectedPoint(options, instance, 18, 0),
  ]);
  glow.restore();

  const upperDeck = projectedPoint(options, instance, 0, 144);
  const beacon = projectedPoint(options, instance, 0, 216);
  options.glowDot(
    upperDeck.x,
    upperDeck.y,
    clamp(heightPixels * 0.12, 8, 66),
    rgba(83, 201, 235, instance.alpha * 0.18),
  );
  options.glowDot(
    beacon.x,
    beacon.y,
    clamp(scale * 3.4, 3, 17),
    rgba(235, 42, 37, instance.alpha * 0.48),
  );
}

function drawRainbowBridge(
  context: LandmarkDrawContext,
  glow: LandmarkDrawContext,
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
): void {
  const totalHeight = 58;
  const deckHalfWidth = 8.8;
  // Generic landmark culling probes the anchor at the near tower. Once that
  // tower passed the camera it used to discard the still-visible far tower and
  // exit deck. Keep the bridge alive until the complete far runout has passed.
  if (!rainbowBridgeHasVisibleRunout(instance.z)) return;

  const scale = projectedScale(options, instance);
  const heightPixels = projectedHeight(options, instance, totalHeight);
  const detailAlpha = smoothstep(28, 82, heightPixels);
  const landmarkAlpha = context.globalAlpha;
  const glowAlpha = glow.globalAlpha * instance.alpha;
  // The anchor is the near main tower. The two approaches and 570m center
  // span reproduce the Port of Tokyo's 918m suspension-bridge section.
  const nearApproach = RAINBOW_BRIDGE_NEAR_APPROACH;
  const farOffset = RAINBOW_BRIDGE_FAR_APPROACH;
  const deckEntry = RAINBOW_BRIDGE_ENTRY_RUNOUT;
  const deckExit = RAINBOW_BRIDGE_EXIT_RUNOUT;
  const nearOffset = Math.min(
    farOffset,
    Math.max(nearApproach, LANDMARK_NEAR_CLIP - instance.z),
  );
  const visibleDeckNear = Math.min(
    deckExit,
    Math.max(deckEntry, LANDMARK_NEAR_CLIP - instance.z),
  );
  const towerOffsets = [0, 570] as const;
  const deckTop = 2.25;

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.globalAlpha = landmarkAlpha;

  const deckWidthAt = (zOffset: number): number => {
    const roadJoinHalfWidth = 5.15;
    if (zOffset < nearApproach) {
      return lerp(
        roadJoinHalfWidth,
        deckHalfWidth,
        smoothstep(deckEntry, nearApproach, zOffset),
      );
    }
    if (zOffset > farOffset) {
      return lerp(
        deckHalfWidth,
        roadJoinHalfWidth,
        smoothstep(farOffset, deckExit, zOffset),
      );
    }
    return deckHalfWidth;
  };
  const parapetHeightAt = (zOffset: number): number => {
    const roadJoinHeight = 0.46;
    if (zOffset < nearApproach) {
      return lerp(
        roadJoinHeight,
        deckTop,
        smoothstep(deckEntry, nearApproach, zOffset),
      );
    }
    if (zOffset > farOffset) {
      return lerp(
        deckTop,
        roadJoinHeight,
        smoothstep(farOffset, deckExit, zOffset),
      );
    }
    return deckTop;
  };
  const drawDeckSection = (sectionNear: number, sectionFar: number): void => {
    const clippedNear = Math.max(sectionNear, visibleDeckNear);
    const clippedFar = Math.min(sectionFar, deckExit);
    if (clippedFar <= clippedNear + 0.001) return;
    const nearHalfWidth = deckWidthAt(clippedNear);
    const farHalfWidth = deckWidthAt(clippedFar);
    const nearParapetHeight = parapetHeightAt(clippedNear);
    const farParapetHeight = parapetHeightAt(clippedFar);

    context.fillStyle = "rgba(16, 25, 30, 0.94)";
    fillPolygon(context, [
      projectedPoint(options, instance, -farHalfWidth, 0, clippedFar),
      projectedPoint(options, instance, farHalfWidth, 0, clippedFar),
      projectedPoint(options, instance, nearHalfWidth, 0, clippedNear),
      projectedPoint(options, instance, -nearHalfWidth, 0, clippedNear),
    ]);

    for (const side of [-1, 1] as const) {
      context.fillStyle = "rgba(77, 91, 97, 0.95)";
      fillPolygon(context, [
        projectedPoint(options, instance, side * farHalfWidth, 0.35, clippedFar),
        projectedPoint(
          options,
          instance,
          side * farHalfWidth,
          farParapetHeight,
          clippedFar,
        ),
        projectedPoint(
          options,
          instance,
          side * nearHalfWidth,
          nearParapetHeight,
          clippedNear,
        ),
        projectedPoint(options, instance, side * nearHalfWidth, 0.35, clippedNear),
      ]);
      context.strokeStyle = "rgba(192, 215, 222, 0.76)";
      context.lineWidth = clamp(scale * 0.22, 0.55, 2.2);
      strokePolyline(context, [
        projectedPoint(
          options,
          instance,
          side * farHalfWidth,
          farParapetHeight,
          clippedFar,
        ),
        projectedPoint(
          options,
          instance,
          side * nearHalfWidth,
          nearParapetHeight,
          clippedNear,
        ),
      ]);
    }
  };

  // Far-to-near sections preserve painter order while both ends narrow and
  // lower into the ordinary expressway instead of being removed as one mesh.
  drawDeckSection(farOffset, deckExit);
  drawDeckSection(nearApproach, farOffset);
  drawDeckSection(deckEntry, nearApproach);

  const drawAnchorage = (zOffset: number, pointsTowardBridge: 1 | -1): void => {
    if (instance.z + zOffset <= LANDMARK_NEAR_CLIP) return;
    const blockHeight = 5.2;
    const blockHalfWidth = 2.15;
    const blockLength = 13;
    const rearOffset = zOffset + pointsTowardBridge * blockLength;
    const anchorageScale = projectedScaleAt(options, instance, zOffset);
    for (const side of [-1, 1] as const) {
      const center = side * (deckHalfWidth + 2.65);
      const left = center - blockHalfWidth;
      const right = center + blockHalfWidth;
      context.fillStyle = "rgba(128, 145, 151, 0.98)";
      fillPolygon(context, [
        projectedPoint(options, instance, left, 0, zOffset),
        projectedPoint(options, instance, left, blockHeight, zOffset),
        projectedPoint(options, instance, right, blockHeight, zOffset),
        projectedPoint(options, instance, right, 0, zOffset),
      ]);
      context.fillStyle = "rgba(177, 193, 197, 0.96)";
      fillPolygon(context, [
        projectedPoint(options, instance, left, blockHeight, zOffset),
        projectedPoint(options, instance, left, blockHeight, rearOffset),
        projectedPoint(options, instance, right, blockHeight, rearOffset),
        projectedPoint(options, instance, right, blockHeight, zOffset),
      ]);
      context.strokeStyle = "rgba(222, 235, 237, 0.72)";
      context.lineWidth = clamp(anchorageScale * 0.16, 0.45, 1.5);
      strokePolyline(context, [
        projectedPoint(options, instance, left, blockHeight, zOffset),
        projectedPoint(options, instance, right, blockHeight, zOffset),
      ]);
    }
  };

  // Real suspension cables terminate in massive concrete anchorages rather
  // than ending in open air. These also hide the visual hand-off to the deck.
  drawAnchorage(nearApproach, 1);
  drawAnchorage(farOffset, -1);

  const drawTower = (zOffset: number, rear: boolean): void => {
    const towerScale = projectedScaleAt(options, instance, zOffset);
    const structureColor = rear
      ? "rgba(105, 126, 133, 0.86)"
      : "rgba(184, 205, 211, 0.98)";
    context.fillStyle = structureColor;
    for (const side of [-1, 1] as const) {
      const baseCenter = side * 10.2;
      const topCenter = side * deckHalfWidth;
      fillPolygon(context, [
        projectedPoint(options, instance, baseCenter - 1.25, 0, zOffset),
        projectedPoint(options, instance, topCenter - 0.75, 56, zOffset),
        projectedPoint(options, instance, topCenter + 0.75, 56, zOffset),
        projectedPoint(options, instance, baseCenter + 1.25, 0, zOffset),
      ]);
    }

    context.strokeStyle = rear
      ? "rgba(143, 165, 171, 0.68)"
      : "rgba(224, 237, 239, 0.92)";
    context.lineWidth = clamp(towerScale * 0.78, 0.75, 4.6);
    for (const height of [31, 48, 56]) {
      const halfWidth = lerp(10.35, 9.35, height / 56);
      strokePolyline(context, [
        projectedPoint(options, instance, -halfWidth, height, zOffset),
        projectedPoint(options, instance, halfWidth, height, zOffset),
      ]);
    }

    context.globalAlpha = landmarkAlpha * detailAlpha;
    context.lineWidth = clamp(towerScale * 0.22, 0.45, 1.55);
    for (const [low, high] of [[7, 20], [20, 31], [31, 43], [43, 55]] as const) {
      const lowHalf = lerp(10.15, deckHalfWidth, low / 56);
      const highHalf = lerp(10.15, deckHalfWidth, high / 56);
      strokePolyline(context, [
        projectedPoint(options, instance, -lowHalf, low, zOffset),
        projectedPoint(options, instance, highHalf, high, zOffset),
      ]);
      strokePolyline(context, [
        projectedPoint(options, instance, lowHalf, low, zOffset),
        projectedPoint(options, instance, -highHalf, high, zOffset),
      ]);
    }
    context.globalAlpha = landmarkAlpha;
  };

  if (instance.z + towerOffsets[1] > LANDMARK_NEAR_CLIP) {
    drawTower(towerOffsets[1], true);
  }
  if (instance.z + towerOffsets[0] > LANDMARK_NEAR_CLIP) {
    drawTower(towerOffsets[0], false);
  }

  const cableHeight = (zOffset: number): number => {
    const [nearTower, farTower] = towerOffsets;
    const anchorageHeight = 5.2;
    const catenaryProgress = (amount: number): number => {
      const t = clamp(amount, 0, 1);
      const tension = 1.7;
      return (Math.cosh(t * tension) - 1) / (Math.cosh(tension) - 1);
    };
    if (zOffset <= nearTower) {
      return lerp(
        anchorageHeight,
        55,
        catenaryProgress((zOffset - nearApproach) / (nearTower - nearApproach)),
      );
    }
    if (zOffset <= farTower) {
      const span = (zOffset - nearTower) / (farTower - nearTower);
      const normalized = Math.abs(span * 2 - 1);
      const sag = 1.18;
      const catenary =
        (Math.cosh(normalized * sag) - 1) / (Math.cosh(sag) - 1);
      return 22 + catenary * 33;
    }
    return lerp(
      anchorageHeight,
      55,
      catenaryProgress((farOffset - zOffset) / (farOffset - farTower)),
    );
  };

  const cableOffsets: number[] = [];
  const appendCableSection = (
    sectionStart: number,
    sectionEnd: number,
    sampleCount: number,
  ): void => {
    const visibleStart = Math.max(sectionStart, nearOffset);
    const visibleEnd = Math.min(sectionEnd, farOffset);
    if (visibleEnd < visibleStart) return;
    if (visibleStart > sectionStart && visibleStart < visibleEnd) {
      cableOffsets.push(visibleStart);
    }
    for (let index = 0; index <= sampleCount; index += 1) {
      const zOffset = lerp(sectionStart, sectionEnd, index / sampleCount);
      if (zOffset < visibleStart || zOffset > visibleEnd) continue;
      if (
        cableOffsets.length === 0 ||
        Math.abs(cableOffsets[cableOffsets.length - 1] - zOffset) > 0.001
      ) {
        cableOffsets.push(zOffset);
      }
    }
  };
  appendCableSection(
    nearApproach,
    towerOffsets[0],
    detailLevel(options.quality, 12, 18, 28),
  );
  appendCableSection(
    towerOffsets[0],
    towerOffsets[1],
    detailLevel(options.quality, 24, 36, 54),
  );
  appendCableSection(
    towerOffsets[1],
    farOffset,
    detailLevel(options.quality, 12, 18, 28),
  );

  if (detailAlpha > 0.002) {
    for (const side of [-1, 1] as const) {
      const cablePoints = cableOffsets.map((zOffset) =>
        projectedPoint(
          options,
          instance,
          side * deckHalfWidth,
          cableHeight(zOffset),
          zOffset,
        ),
      );

      context.globalAlpha = landmarkAlpha * detailAlpha;
      context.strokeStyle = "rgba(207, 226, 230, 0.93)";
      context.lineWidth = clamp(scale * 0.58, 0.65, 3.5);
      strokePolyline(context, cablePoints);

      const hangerAlpha = smoothstep(38, 92, heightPixels);
      context.globalAlpha = landmarkAlpha * hangerAlpha;
      context.strokeStyle = "rgba(164, 195, 203, 0.73)";
      context.lineWidth = clamp(scale * 0.2, 0.45, 1.45);
      const hangerStep = detailLevel(options.quality, 30, 21, 16);
      const firstHanger = Math.ceil((nearApproach + 1) / hangerStep) * hangerStep;
      for (let zOffset = firstHanger; zOffset < farOffset; zOffset += hangerStep) {
        if (zOffset < nearOffset) continue;
        if (towerOffsets.some((towerOffset) => Math.abs(zOffset - towerOffset) < 4)) {
          continue;
        }
        const hangerTop = cableHeight(zOffset);
        if (hangerTop <= deckTop + 0.7) continue;
        strokePolyline(context, [
          projectedPoint(options, instance, side * deckHalfWidth, deckTop, zOffset),
          projectedPoint(
            options,
            instance,
            side * deckHalfWidth,
            hangerTop,
            zOffset,
          ),
        ]);
      }

      glow.save();
      glow.globalAlpha = glowAlpha * 0.34 * detailAlpha;
      glow.strokeStyle = "rgba(126, 205, 229, 0.3)";
      glow.lineWidth = clamp(scale * 2, 2, 12);
      strokePolyline(glow, cablePoints);
      glow.restore();
    }
  }

  if (detailAlpha > 0.002) {
    context.globalAlpha = landmarkAlpha * detailAlpha;
    context.fillStyle = "rgba(211, 238, 242, 0.92)";
    const lightStep = detailLevel(options.quality, 58, 42, 31);
    for (let zOffset = nearApproach + 8; zOffset < farOffset; zOffset += lightStep) {
      if (zOffset < nearOffset) continue;
      for (const side of [-1, 1] as const) {
        const light = projectedPoint(
          options,
          instance,
          side * (deckHalfWidth - 0.55),
          deckTop + 0.45,
          zOffset,
        );
        context.beginPath();
        context.arc(light.x, light.y, clamp(scale * 0.22, 0.5, 1.6), 0, TAU);
        context.fill();
        options.glowDot(
          light.x,
          light.y,
          clamp(scale * 1.25, 2.5, 10),
          rgba(155, 222, 238, instance.alpha * detailAlpha * 0.16),
        );
      }
    }
  }
  context.restore();

  for (const zOffset of towerOffsets) {
    if (instance.z + zOffset <= LANDMARK_NEAR_CLIP) continue;
    for (const side of [-1, 1] as const) {
      const beacon = projectedPoint(options, instance, side * deckHalfWidth, 57.2, zOffset);
      options.glowDot(
        beacon.x,
        beacon.y,
        clamp(scale * 3, 3, 15),
        rgba(240, 45, 39, instance.alpha * 0.48),
      );
    }
  }
}
function drawBigSight(
  context: LandmarkDrawContext,
  glow: LandmarkDrawContext,
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
): void {
  const totalHeight = 50;
  if (!isPotentiallyVisible(options, instance, totalHeight, 53)) return;

  const scale = projectedScale(options, instance);
  const heightPixels = projectedHeight(options, instance, totalHeight);
  const detailAlpha = smoothstep(28, 82, heightPixels);
  const fineAlpha = smoothstep(56, 138, heightPixels);
  const landmarkAlpha = context.globalAlpha;
  const glowAlpha = glow.globalAlpha * instance.alpha;

  context.save();
  context.globalAlpha = landmarkAlpha;
  context.lineJoin = "round";
  context.fillStyle = "rgba(17, 27, 33, 0.98)";
  fillPolygon(context, [
    projectedPoint(options, instance, -54, 0),
    projectedPoint(options, instance, -49, 13),
    projectedPoint(options, instance, 49, 13),
    projectedPoint(options, instance, 54, 0),
  ]);
  context.fillStyle = "rgba(47, 67, 77, 0.94)";
  fillPolygon(context, [
    projectedPoint(options, instance, -45, 12),
    projectedPoint(options, instance, 45, 12),
    projectedPoint(options, instance, 41, 17),
    projectedPoint(options, instance, -41, 17),
  ]);

  const moduleCenters = [-31.5, -10.5, 10.5, 31.5] as const;
  for (let index = 0; index < moduleCenters.length; index += 1) {
    const center = moduleCenters[index];
    const rear = index === 0 || index === 3;
    const zOffset = rear ? 4.2 : 0;
    const topHalfWidth = 11.8;
    const footHalfWidth = 4.2;
    const footHeight = 15;
    const topHeight = 47;
    const faceGradient = context.createLinearGradient(
      0,
      projectedPoint(options, instance, center, topHeight, zOffset).y,
      0,
      projectedPoint(options, instance, center, footHeight, zOffset).y,
    );
    faceGradient.addColorStop(0, rear ? "#687a82" : "#879aa1");
    faceGradient.addColorStop(0.55, rear ? "#43555e" : "#607680");
    faceGradient.addColorStop(1, "#273942");
    context.fillStyle = faceGradient;
    fillPolygon(context, [
      projectedPoint(options, instance, center - footHalfWidth, footHeight, zOffset),
      projectedPoint(options, instance, center - topHalfWidth, topHeight, zOffset),
      projectedPoint(options, instance, center + topHalfWidth, topHeight, zOffset),
      projectedPoint(options, instance, center + footHalfWidth, footHeight, zOffset),
    ]);
    context.globalAlpha = landmarkAlpha * detailAlpha;
    context.strokeStyle = rear
      ? "rgba(143, 174, 184, 0.58)"
      : "rgba(198, 224, 230, 0.8)";
    context.lineWidth = clamp(scale * 0.34, 0.5, 2.2);
    for (let rib = 1; rib < 5; rib += 1) {
      const t = rib / 5;
      const height = lerp(footHeight, topHeight, t);
      const halfWidth = lerp(footHalfWidth, topHalfWidth, t);
      strokePolyline(context, [
        projectedPoint(options, instance, center - halfWidth, height, zOffset),
        projectedPoint(options, instance, center + halfWidth, height, zOffset),
      ]);
    }
    context.globalAlpha = landmarkAlpha;
  }

  context.globalAlpha = landmarkAlpha * fineAlpha;
  context.fillStyle = "rgba(131, 215, 236, 0.78)";
  fillPolygon(context, [
    projectedPoint(options, instance, -38, 16.2),
    projectedPoint(options, instance, 38, 16.2),
    projectedPoint(options, instance, 37, 17.8),
    projectedPoint(options, instance, -37, 17.8),
  ]);
  context.strokeStyle = "rgba(189, 222, 229, 0.66)";
  context.lineWidth = clamp(scale * 0.28, 0.5, 1.8);
  for (const center of moduleCenters) {
    strokePolyline(context, [
      projectedPoint(options, instance, center - 11.8, 47),
      projectedPoint(options, instance, center + 11.8, 47),
    ]);
  }
  context.restore();

  glow.save();
  glow.globalAlpha = glowAlpha * 0.36;
  glow.strokeStyle = "rgba(92, 192, 222, 0.3)";
  glow.lineWidth = clamp(scale * 2.4, 2.5, 14);
  strokePolyline(glow, [
    projectedPoint(options, instance, -38, 17),
    projectedPoint(options, instance, 38, 17),
  ]);
  glow.restore();

  const centerLight = projectedPoint(options, instance, 0, 17);
  options.glowDot(
    centerLight.x,
    centerLight.y,
    clamp(heightPixels * 0.35, 7, 48),
    rgba(74, 183, 218, instance.alpha * 0.13),
  );
}

function drawHarborCranes(
  context: LandmarkDrawContext,
  glow: LandmarkDrawContext,
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
): void {
  const totalHeight = 59;
  if (!isPotentiallyVisible(options, instance, totalHeight, 76)) return;

  const groupHeightPixels = projectedHeight(options, instance, totalHeight);
  const detailAlpha = smoothstep(26, 76, groupHeightPixels);
  const fineAlpha = smoothstep(54, 132, groupHeightPixels);
  const landmarkAlpha = context.globalAlpha;
  const glowAlpha = glow.globalAlpha * instance.alpha;
  const outward = instance.lateral < 0 ? -1 : 1;
  const craneCount = detailLevel(options.quality, 3, 4, 5);

  context.save();
  context.globalAlpha = landmarkAlpha;
  context.lineCap = "round";
  context.lineJoin = "round";

  const containerColors = [
    "#28434e",
    "#5c3329",
    "#3d4f40",
    "#454a53",
    "#614a28",
  ] as const;
  const containerRows = detailLevel(options.quality, 2, 3, 3);
  for (let row = 0; row < containerRows; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      if (seeded(instance.block * 31 + row * 7 + column, 701) < 0.17) continue;
      const x = outward * (column * 13 - 37);
      const height = row * 3.2;
      const width = 11.5;
      context.fillStyle = containerColors[
        hashInteger(instance.block * 19 + row * 11 + column) % containerColors.length
      ];
      fillPolygon(context, [
        projectedPoint(options, instance, x - width * 0.5, height, 9),
        projectedPoint(options, instance, x + width * 0.5, height, 9),
        projectedPoint(options, instance, x + width * 0.5, height + 2.8, 9),
        projectedPoint(options, instance, x - width * 0.5, height + 2.8, 9),
      ]);
    }
  }

  const beaconPoints: ScreenPoint[] = [];
  for (let index = craneCount - 1; index >= 0; index -= 1) {
    const seed = instance.block * 43 + index * 17;
    const lateralOffset = outward * (
      (index - (craneCount - 1) * 0.5) * 25 +
      (seeded(seed, 719) - 0.5) * 6
    );
    const zOffset = index * 23 + seeded(seed, 727) * 12;
    const craneScale = projectedScaleAt(options, instance, zOffset);
    // Tokyo Port's shuttle-boom cranes cluster around 58-62m tall.
    const height = 55 + seeded(seed, 733) * 4;
    const span = 26 + seeded(seed, 739) * 8;
    const top = height * 0.78;
    const boomLength = 28 + seeded(seed, 743) * 12;
    const boomDirection = -outward;
    const palette = seeded(seed, 751) > 0.46;
    const structureColor = palette
      ? "rgba(168, 184, 185, 0.9)"
      : "rgba(166, 91, 64, 0.9)";
    const accentColor = palette
      ? "rgba(201, 73, 53, 0.86)"
      : "rgba(211, 205, 174, 0.85)";

    context.globalAlpha = landmarkAlpha;
    context.strokeStyle = "rgba(24, 34, 38, 0.72)";
    context.lineWidth = clamp(craneScale * 1.35, 1, 7);
    for (const side of [-1, 1] as const) {
      strokePolyline(context, [
        projectedPoint(
          options,
          instance,
          lateralOffset + side * span * 0.43,
          0,
          zOffset,
        ),
        projectedPoint(
          options,
          instance,
          lateralOffset + side * span * 0.25,
          top,
          zOffset,
        ),
      ]);
    }
    context.strokeStyle = structureColor;
    context.lineWidth = clamp(craneScale * 0.72, 0.65, 4.5);
    for (const side of [-1, 1] as const) {
      strokePolyline(context, [
        projectedPoint(
          options,
          instance,
          lateralOffset + side * span * 0.43,
          0,
          zOffset,
        ),
        projectedPoint(
          options,
          instance,
          lateralOffset + side * span * 0.25,
          top,
          zOffset,
        ),
      ]);
    }

    context.lineWidth = clamp(craneScale * 1.08, 0.9, 6);
    strokePolyline(context, [
      projectedPoint(
        options,
        instance,
        lateralOffset - span * 0.42,
        top,
        zOffset,
      ),
      projectedPoint(
        options,
        instance,
        lateralOffset + span * 0.42,
        top,
        zOffset,
      ),
    ]);
    context.strokeStyle = accentColor;
    context.lineWidth = clamp(craneScale * 0.66, 0.6, 4.2);
    strokePolyline(context, [
      projectedPoint(options, instance, lateralOffset, top, zOffset),
      projectedPoint(
        options,
        instance,
        lateralOffset + boomDirection * boomLength,
        height,
        zOffset,
      ),
    ]);
    strokePolyline(context, [
      projectedPoint(options, instance, lateralOffset, top, zOffset),
      projectedPoint(
        options,
        instance,
        lateralOffset - boomDirection * span * 0.55,
        height * 0.9,
        zOffset,
      ),
    ]);

    context.globalAlpha = landmarkAlpha * detailAlpha;
    context.strokeStyle = "rgba(170, 185, 183, 0.7)";
    context.lineWidth = clamp(craneScale * 0.2, 0.4, 1.5);
    const braceLevels = detailLevel(options.quality, 3, 5, 7);
    for (let brace = 0; brace < braceLevels; brace += 1) {
      const h0 = lerp(3, top, brace / braceLevels);
      const h1 = lerp(3, top, (brace + 1) / braceLevels);
      const half0 = lerp(span * 0.42, span * 0.25, h0 / top);
      const half1 = lerp(span * 0.42, span * 0.25, h1 / top);
      strokePolyline(context, [
        projectedPoint(options, instance, lateralOffset - half0, h0, zOffset),
        projectedPoint(options, instance, lateralOffset + half1, h1, zOffset),
      ]);
      strokePolyline(context, [
        projectedPoint(options, instance, lateralOffset + half0, h0, zOffset),
        projectedPoint(options, instance, lateralOffset - half1, h1, zOffset),
      ]);
    }

    context.globalAlpha = landmarkAlpha * fineAlpha;
    const trolleyX = lateralOffset + boomDirection * boomLength * 0.52;
    context.strokeStyle = "rgba(109, 128, 132, 0.74)";
    context.lineWidth = clamp(craneScale * 0.13, 0.35, 1.2);
    strokePolyline(context, [
      projectedPoint(options, instance, trolleyX, height * 0.94, zOffset),
      projectedPoint(options, instance, trolleyX, 10, zOffset),
    ]);
    context.fillStyle = "rgba(198, 210, 207, 0.9)";
    fillPolygon(context, [
      projectedPoint(options, instance, trolleyX - 1.7, height * 0.9, zOffset),
      projectedPoint(options, instance, trolleyX + 1.7, height * 0.9, zOffset),
      projectedPoint(options, instance, trolleyX + 1.5, height * 0.96, zOffset),
      projectedPoint(options, instance, trolleyX - 1.5, height * 0.96, zOffset),
    ]);

    beaconPoints.push(
      projectedPoint(
        options,
        instance,
        lateralOffset + boomDirection * boomLength,
        height,
        zOffset,
      ),
    );
  }
  context.restore();

  glow.save();
  glow.globalAlpha = glowAlpha * 0.28;
  glow.fillStyle = "rgba(71, 147, 166, 0.24)";
  const base = projectedPoint(options, instance, 0, 5);
  glow.beginPath();
  glow.ellipse(
    base.x,
    base.y,
    clamp(groupHeightPixels * 1.25, 18, 130),
    clamp(groupHeightPixels * 0.24, 7, 32),
    0,
    0,
    TAU,
  );
  glow.fill();
  glow.restore();

  for (const beacon of beaconPoints) {
    options.glowDot(
      beacon.x,
      beacon.y,
      clamp(groupHeightPixels * 0.055, 3, 13),
      rgba(244, 46, 35, instance.alpha * 0.48),
    );
  }
}

function drawTokyoMetropolitanGovernment(
  context: LandmarkDrawContext,
  glow: LandmarkDrawContext,
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
): void {
  const totalHeight = 243.4;
  if (!isPotentiallyVisible(options, instance, totalHeight, 55)) return;

  const scale = projectedScale(options, instance);
  const heightPixels = projectedHeight(options, instance, totalHeight);
  const detailAlpha = smoothstep(42, 116, heightPixels);
  const fineAlpha = smoothstep(90, 205, heightPixels);
  const landmarkAlpha = context.globalAlpha;
  const glowAlpha = glow.globalAlpha * instance.alpha;
  const top = projectedPoint(options, instance, 0, totalHeight);
  const base = projectedPoint(options, instance, 0, 0);

  context.save();
  context.globalAlpha = landmarkAlpha;
  context.lineJoin = "round";
  const facade = context.createLinearGradient(0, top.y, 0, base.y);
  facade.addColorStop(0, "#54626a");
  facade.addColorStop(0.42, "#2f3d45");
  facade.addColorStop(1, "#182229");
  context.fillStyle = facade;
  fillPolygon(
    context,
    projectedRectangle(options, instance, -53, 53, 0, 42),
  );
  fillPolygon(
    context,
    projectedRectangle(options, instance, -43, 43, 40, 163),
  );
  for (const side of [-1, 1] as const) {
    const inner = side * 5;
    const outer = side * 42;
    fillPolygon(context, [
      projectedPoint(options, instance, inner, 158),
      projectedPoint(options, instance, side * 8, 233),
      projectedPoint(options, instance, side * 15, 241),
      projectedPoint(options, instance, side * 36, 241),
      projectedPoint(options, instance, side * 42, 229),
      projectedPoint(options, instance, outer, 158),
    ]);
  }

  context.fillStyle = "rgba(17, 27, 33, 0.94)";
  fillPolygon(
    context,
    projectedRectangle(options, instance, -4.2, 4.2, 158, 232),
  );
  context.fillStyle = "rgba(94, 112, 121, 0.82)";
  for (const side of [-1, 1] as const) {
    fillPolygon(
      context,
      projectedRectangle(
        options,
        instance,
        side < 0 ? -38 : 12,
        side < 0 ? -12 : 38,
        232,
        240,
      ),
    );
  }

  context.globalAlpha = landmarkAlpha * detailAlpha;
  context.strokeStyle = "rgba(153, 186, 201, 0.66)";
  context.lineWidth = clamp(scale * 0.22, 0.45, 1.5);
  for (let height = 52; height < 229; height += 10.5) {
    if (height < 160) {
      strokePolyline(context, [
        projectedPoint(options, instance, -41, height),
        projectedPoint(options, instance, 41, height),
      ]);
    } else {
      for (const side of [-1, 1] as const) {
        strokePolyline(context, [
          projectedPoint(options, instance, side * 8, height),
          projectedPoint(options, instance, side * 40, height),
        ]);
      }
    }
  }
  context.strokeStyle = "rgba(105, 147, 166, 0.7)";
  context.lineWidth = clamp(scale * 0.3, 0.5, 1.9);
  for (const lateral of [-31, -20, -10, 10, 20, 31]) {
    strokePolyline(context, [
      projectedPoint(options, instance, lateral, 43),
      projectedPoint(options, instance, lateral, 236),
    ]);
  }

  context.globalAlpha = landmarkAlpha * fineAlpha;
  context.fillStyle = "rgba(220, 236, 241, 0.72)";
  const windowRows = detailLevel(options.quality, 4, 6, 8);
  for (let row = 0; row < windowRows; row += 1) {
    const height = 67 + row * 11.5;
    for (const lateral of [-34, -25, -16, 16, 25, 34]) {
      const point = projectedPoint(options, instance, lateral, height);
      context.fillRect(
        point.x - clamp(scale * 0.8, 0.5, 2.2),
        point.y - clamp(scale * 0.45, 0.4, 1.6),
        clamp(scale * 1.6, 0.8, 4.4),
        clamp(scale * 0.9, 0.7, 3.2),
      );
    }
  }
  context.restore();

  glow.save();
  glow.globalAlpha = glowAlpha * 0.32;
  glow.strokeStyle = "rgba(116, 191, 221, 0.28)";
  glow.lineWidth = clamp(scale * 2.4, 2.5, 16);
  for (const side of [-1, 1] as const) {
    strokePolyline(glow, [
      projectedPoint(options, instance, side * 42, 44),
      projectedPoint(options, instance, side * 40, 226),
      projectedPoint(options, instance, side * 25, 241),
    ]);
  }
  glow.restore();

  for (const lateral of [-25, 25]) {
    const beacon = projectedPoint(options, instance, lateral, 241);
    options.glowDot(
      beacon.x,
      beacon.y,
      clamp(heightPixels * 0.035, 3, 12),
      rgba(239, 47, 38, instance.alpha * 0.44),
    );
  }
}

function drawToranomonHills(
  context: LandmarkDrawContext,
  glow: LandmarkDrawContext,
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
): void {
  const totalHeight = 247;
  if (!isPotentiallyVisible(options, instance, totalHeight, 45)) return;

  const scale = projectedScale(options, instance);
  const heightPixels = projectedHeight(options, instance, totalHeight);
  const detailAlpha = smoothstep(42, 118, heightPixels);
  const fineAlpha = smoothstep(92, 210, heightPixels);
  const landmarkAlpha = context.globalAlpha;
  const glowAlpha = glow.globalAlpha * instance.alpha;
  const top = projectedPoint(options, instance, 0, totalHeight);
  const base = projectedPoint(options, instance, 0, 0);

  context.save();
  context.globalAlpha = landmarkAlpha;
  context.lineJoin = "round";
  const glass = context.createLinearGradient(0, top.y, 0, base.y);
  glass.addColorStop(0, "#78919c");
  glass.addColorStop(0.28, "#3e5966");
  glass.addColorStop(0.72, "#172a34");
  glass.addColorStop(1, "#111c23");
  context.fillStyle = glass;
  fillPolygon(context, [
    projectedPoint(options, instance, -43, 0),
    projectedPoint(options, instance, -39, 57),
    projectedPoint(options, instance, -34, 238),
    projectedPoint(options, instance, -27, 244),
    projectedPoint(options, instance, 27, 244),
    projectedPoint(options, instance, 34, 238),
    projectedPoint(options, instance, 39, 57),
    projectedPoint(options, instance, 43, 0),
  ]);
  context.fillStyle = "rgba(9, 20, 27, 0.72)";
  fillPolygon(context, [
    projectedPoint(options, instance, 34, 238),
    projectedPoint(options, instance, 39, 57),
    projectedPoint(options, instance, 39, 57, 8),
    projectedPoint(options, instance, 31, 238, 8),
  ]);
  context.fillStyle = "rgba(37, 54, 62, 0.96)";
  fillPolygon(
    context,
    projectedRectangle(options, instance, -48, 48, 0, 39),
  );

  context.globalAlpha = landmarkAlpha * detailAlpha;
  context.strokeStyle = "rgba(158, 206, 222, 0.62)";
  context.lineWidth = clamp(scale * 0.19, 0.42, 1.45);
  for (let height = 51; height < 240; height += 10.8) {
    const halfWidth = lerp(38.7, 34, (height - 51) / 189);
    strokePolyline(context, [
      projectedPoint(options, instance, -halfWidth, height),
      projectedPoint(options, instance, halfWidth, height),
    ]);
  }
  context.strokeStyle = "rgba(109, 166, 190, 0.68)";
  context.lineWidth = clamp(scale * 0.26, 0.5, 1.8);
  for (const lateral of [-26, -13, 0, 13, 26]) {
    strokePolyline(context, [
      projectedPoint(options, instance, lateral, 40),
      projectedPoint(options, instance, lateral * 0.82, 242),
    ]);
  }

  context.globalAlpha = landmarkAlpha * fineAlpha;
  context.fillStyle = "rgba(187, 231, 243, 0.78)";
  fillPolygon(
    context,
    projectedRectangle(options, instance, -33, 33, 196, 200),
  );
  fillPolygon(
    context,
    projectedRectangle(options, instance, -29, 29, 242, 247),
  );
  context.restore();

  glow.save();
  glow.globalAlpha = glowAlpha * 0.34;
  glow.strokeStyle = "rgba(104, 199, 229, 0.3)";
  glow.lineWidth = clamp(scale * 2.5, 2.5, 17);
  strokePolyline(glow, [
    projectedPoint(options, instance, -40, 40),
    projectedPoint(options, instance, -27, 244),
    projectedPoint(options, instance, 27, 244),
    projectedPoint(options, instance, 40, 40),
  ]);
  glow.restore();

  const beacon = projectedPoint(options, instance, 0, totalHeight);
  options.glowDot(
    beacon.x,
    beacon.y,
    clamp(heightPixels * 0.026, 3, 11),
    rgba(240, 47, 38, instance.alpha * 0.46),
  );
}

function drawShibuyaScrambleSquare(
  context: LandmarkDrawContext,
  glow: LandmarkDrawContext,
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
): void {
  const totalHeight = 229.7;
  if (!isPotentiallyVisible(options, instance, totalHeight, 42)) return;

  const scale = projectedScale(options, instance);
  const heightPixels = projectedHeight(options, instance, totalHeight);
  const detailAlpha = smoothstep(40, 112, heightPixels);
  const fineAlpha = smoothstep(86, 195, heightPixels);
  const landmarkAlpha = context.globalAlpha;
  const glowAlpha = glow.globalAlpha * instance.alpha;
  const top = projectedPoint(options, instance, 0, totalHeight);
  const base = projectedPoint(options, instance, 0, 0);

  const tiers = [
    { left: -40, right: 40, bottom: 0, top: 77 },
    { left: -35, right: 34, bottom: 76, top: 154 },
    { left: -30, right: 32, bottom: 153, top: 220 },
  ] as const;

  context.save();
  context.globalAlpha = landmarkAlpha;
  context.lineJoin = "round";
  const facade = context.createLinearGradient(0, top.y, 0, base.y);
  facade.addColorStop(0, "#78949e");
  facade.addColorStop(0.3, "#385461");
  facade.addColorStop(0.66, "#192e39");
  facade.addColorStop(1, "#101a21");
  context.fillStyle = facade;
  for (const tier of tiers) {
    fillPolygon(
      context,
      projectedRectangle(
        options,
        instance,
        tier.left,
        tier.right,
        tier.bottom,
        tier.top,
      ),
    );
    context.fillStyle = "rgba(7, 17, 23, 0.76)";
    fillPolygon(context, [
      projectedPoint(options, instance, tier.right, tier.bottom),
      projectedPoint(options, instance, tier.right, tier.top),
      projectedPoint(options, instance, tier.right, tier.top, 7),
      projectedPoint(options, instance, tier.right, tier.bottom, 7),
    ]);
    context.fillStyle = facade;
  }
  context.fillStyle = "rgba(91, 110, 116, 0.96)";
  fillPolygon(
    context,
    projectedRectangle(options, instance, -27, 29, 218, 226),
  );
  context.fillStyle = "rgba(35, 47, 52, 0.98)";
  fillPolygon(
    context,
    projectedRectangle(options, instance, -14, 17, 226, totalHeight),
  );

  context.globalAlpha = landmarkAlpha * detailAlpha;
  context.strokeStyle = "rgba(159, 205, 219, 0.66)";
  context.lineWidth = clamp(scale * 0.2, 0.42, 1.45);
  for (const tier of tiers) {
    for (let height = tier.bottom + 10; height < tier.top; height += 10.5) {
      strokePolyline(context, [
        projectedPoint(options, instance, tier.left + 1.5, height),
        projectedPoint(options, instance, tier.right - 1.5, height),
      ]);
    }
  }
  context.strokeStyle = "rgba(107, 164, 184, 0.7)";
  context.lineWidth = clamp(scale * 0.28, 0.5, 1.8);
  for (const lateral of [-27, -14, 0, 14, 27]) {
    strokePolyline(context, [
      projectedPoint(options, instance, lateral, 2),
      projectedPoint(options, instance, lateral * 0.72, 218),
    ]);
  }

  context.globalAlpha = landmarkAlpha * fineAlpha;
  context.fillStyle = "rgba(207, 239, 244, 0.82)";
  for (const [bottom, tierHalfWidth] of [[73, 39], [150, 33], [214, 29]] as const) {
    fillPolygon(
      context,
      projectedRectangle(
        options,
        instance,
        -tierHalfWidth,
        tierHalfWidth,
        bottom,
        bottom + 3.4,
      ),
    );
  }
  context.restore();

  glow.save();
  glow.globalAlpha = glowAlpha * 0.35;
  glow.strokeStyle = "rgba(97, 197, 226, 0.3)";
  glow.lineWidth = clamp(scale * 2.5, 2.5, 17);
  strokePolyline(glow, [
    projectedPoint(options, instance, -40, 0),
    projectedPoint(options, instance, -30, 220),
    projectedPoint(options, instance, 32, 220),
    projectedPoint(options, instance, 40, 0),
  ]);
  glow.restore();

  const beacon = projectedPoint(options, instance, 0, totalHeight);
  options.glowDot(
    beacon.x,
    beacon.y,
    clamp(heightPixels * 0.028, 3, 11),
    rgba(239, 45, 37, instance.alpha * 0.46),
  );
}

function drawCocoonTower(
  context: LandmarkDrawContext,
  glow: LandmarkDrawContext,
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
): void {
  const totalHeight = 203.65;
  if (!isPotentiallyVisible(options, instance, totalHeight, 29)) return;

  const scale = projectedScale(options, instance);
  const heightPixels = projectedHeight(options, instance, totalHeight);
  const detailAlpha = smoothstep(38, 108, heightPixels);
  const fineAlpha = smoothstep(82, 185, heightPixels);
  const landmarkAlpha = context.globalAlpha;
  const glowAlpha = glow.globalAlpha * instance.alpha;
  const halfWidthAt = (height: number): number => {
    if (height < 52) return lerp(13, 24, height / 52);
    if (height < 112) return lerp(24, 27, (height - 52) / 60);
    if (height < 176) return lerp(27, 18, (height - 112) / 64);
    return lerp(18, 2.5, clamp((height - 176) / 27.65, 0, 1));
  };

  const silhouetteHeights = [0, 24, 52, 82, 112, 142, 176, 194, 203.65];
  const silhouette: ScreenPoint[] = [];
  for (const height of silhouetteHeights) {
    silhouette.push(
      projectedPoint(options, instance, -halfWidthAt(height), height),
    );
  }
  for (let index = silhouetteHeights.length - 1; index >= 0; index -= 1) {
    const height = silhouetteHeights[index];
    silhouette.push(
      projectedPoint(options, instance, halfWidthAt(height), height),
    );
  }

  context.save();
  context.globalAlpha = landmarkAlpha;
  context.lineJoin = "round";
  const top = projectedPoint(options, instance, 0, totalHeight);
  const base = projectedPoint(options, instance, 0, 0);
  const facade = context.createLinearGradient(0, top.y, 0, base.y);
  facade.addColorStop(0, "#9aabb1");
  facade.addColorStop(0.28, "#526a75");
  facade.addColorStop(0.72, "#233943");
  facade.addColorStop(1, "#111e25");
  context.fillStyle = facade;
  fillPolygon(context, silhouette);
  context.fillStyle = "rgba(8, 25, 34, 0.78)";
  fillPolygon(context, [
    projectedPoint(options, instance, -4, 8),
    projectedPoint(options, instance, -2.2, 196),
    projectedPoint(options, instance, 2.2, 196),
    projectedPoint(options, instance, 4, 8),
  ]);

  context.globalAlpha = landmarkAlpha * detailAlpha;
  context.strokeStyle = "rgba(220, 232, 232, 0.86)";
  context.lineWidth = clamp(scale * 0.72, 0.65, 4.2);
  const latticeCount = detailLevel(options.quality, 5, 8, 11);
  for (let index = 0; index < latticeCount; index += 1) {
    const low = 8 + (index / latticeCount) * 160;
    const high = Math.min(198, low + 34);
    strokePolyline(context, [
      projectedPoint(options, instance, -halfWidthAt(low) * 0.94, low),
      projectedPoint(options, instance, halfWidthAt(high) * 0.94, high),
    ]);
    strokePolyline(context, [
      projectedPoint(options, instance, halfWidthAt(low) * 0.94, low),
      projectedPoint(options, instance, -halfWidthAt(high) * 0.94, high),
    ]);
  }
  context.strokeStyle = "rgba(112, 184, 207, 0.72)";
  context.lineWidth = clamp(scale * 0.3, 0.5, 1.8);
  for (const height of [43, 77, 112, 146, 177]) {
    strokePolyline(context, [
      projectedPoint(options, instance, -halfWidthAt(height) * 0.9, height),
      projectedPoint(options, instance, halfWidthAt(height) * 0.9, height),
    ]);
  }

  context.globalAlpha = landmarkAlpha * fineAlpha;
  context.strokeStyle = "rgba(174, 225, 238, 0.82)";
  context.lineWidth = clamp(scale * 0.25, 0.45, 1.5);
  strokePolyline(context, [
    projectedPoint(options, instance, 0, 7),
    projectedPoint(options, instance, 0, 198),
  ]);
  context.restore();

  glow.save();
  glow.globalAlpha = glowAlpha * 0.34;
  glow.strokeStyle = "rgba(98, 194, 222, 0.28)";
  glow.lineWidth = clamp(scale * 2.6, 2.5, 17);
  strokePolyline(glow, [
    projectedPoint(options, instance, -13, 0),
    projectedPoint(options, instance, -27, 112),
    projectedPoint(options, instance, 0, totalHeight),
    projectedPoint(options, instance, 27, 112),
    projectedPoint(options, instance, 13, 0),
  ]);
  glow.restore();

  const beacon = projectedPoint(options, instance, 0, totalHeight);
  options.glowDot(
    beacon.x,
    beacon.y,
    clamp(heightPixels * 0.027, 3, 10),
    rgba(239, 48, 38, instance.alpha * 0.44),
  );
}

function drawFujiTelevision(
  context: LandmarkDrawContext,
  glow: LandmarkDrawContext,
  options: ProceduralLandmarkOptions,
  instance: ProceduralLandmarkInstance,
): void {
  const totalHeight = 123.45;
  if (!isPotentiallyVisible(options, instance, totalHeight, 105)) return;

  const scale = projectedScale(options, instance);
  const heightPixels = projectedHeight(options, instance, totalHeight);
  const detailAlpha = smoothstep(32, 88, heightPixels);
  const fineAlpha = smoothstep(64, 145, heightPixels);
  const landmarkAlpha = context.globalAlpha;
  const glowAlpha = glow.globalAlpha * instance.alpha;

  context.save();
  context.globalAlpha = landmarkAlpha;
  context.lineJoin = "round";
  context.fillStyle = "rgba(22, 34, 41, 0.98)";
  fillPolygon(
    context,
    projectedRectangle(options, instance, -102, -62, 0, 108),
  );
  fillPolygon(
    context,
    projectedRectangle(options, instance, 62, 102, 0, 123),
  );
  context.fillStyle = "rgba(45, 62, 70, 0.96)";
  fillPolygon(
    context,
    projectedRectangle(options, instance, -61, 61, 0, 38),
  );
  fillPolygon(
    context,
    projectedRectangle(options, instance, -70, 70, 54, 82),
  );
  context.fillStyle = "rgba(75, 94, 101, 0.92)";
  fillPolygon(
    context,
    projectedRectangle(options, instance, -102, 102, 105, 116),
  );

  context.globalAlpha = landmarkAlpha * detailAlpha;
  context.strokeStyle = "rgba(171, 194, 200, 0.84)";
  context.lineWidth = clamp(scale * 0.7, 0.65, 4.3);
  for (const lateral of [-102, -62, 62, 102]) {
    strokePolyline(context, [
      projectedPoint(options, instance, lateral, 0),
      projectedPoint(options, instance, lateral, lateral > 0 ? 123 : 108),
    ]);
  }
  for (const height of [18, 38, 55, 82, 106, 116]) {
    strokePolyline(context, [
      projectedPoint(options, instance, -102, height),
      projectedPoint(options, instance, 102, height),
    ]);
  }
  context.strokeStyle = "rgba(118, 147, 158, 0.72)";
  context.lineWidth = clamp(scale * 0.32, 0.5, 2);
  for (const [low, high] of [[1, 37], [39, 81], [83, 105]] as const) {
    strokePolyline(context, [
      projectedPoint(options, instance, -100, low),
      projectedPoint(options, instance, 100, high),
    ]);
    strokePolyline(context, [
      projectedPoint(options, instance, 100, low),
      projectedPoint(options, instance, -100, high),
    ]);
  }

  const sphereCenter = projectedPoint(options, instance, 14, 107.45);
  const sphereRadius = Math.max(2, 16 * scale);
  const sphereGradient = context.createRadialGradient(
    sphereCenter.x - sphereRadius * 0.32,
    sphereCenter.y - sphereRadius * 0.38,
    sphereRadius * 0.08,
    sphereCenter.x,
    sphereCenter.y,
    sphereRadius,
  );
  sphereGradient.addColorStop(0, "rgba(228, 241, 243, 0.98)");
  sphereGradient.addColorStop(0.42, "rgba(132, 158, 166, 0.98)");
  sphereGradient.addColorStop(1, "rgba(41, 59, 66, 0.98)");
  context.globalAlpha = landmarkAlpha;
  context.fillStyle = sphereGradient;
  context.beginPath();
  context.ellipse(
    sphereCenter.x,
    sphereCenter.y,
    sphereRadius,
    sphereRadius * 0.94,
    0,
    0,
    TAU,
  );
  context.fill();
  context.globalAlpha = landmarkAlpha * fineAlpha;
  context.strokeStyle = "rgba(215, 233, 236, 0.82)";
  context.lineWidth = clamp(scale * 0.32, 0.5, 1.8);
  context.stroke();
  context.beginPath();
  context.ellipse(
    sphereCenter.x,
    sphereCenter.y,
    sphereRadius * 0.72,
    sphereRadius * 0.94,
    0,
    0,
    TAU,
  );
  context.stroke();
  context.beginPath();
  context.ellipse(
    sphereCenter.x,
    sphereCenter.y,
    sphereRadius,
    sphereRadius * 0.34,
    0,
    0,
    TAU,
  );
  context.stroke();
  context.restore();

  glow.save();
  glow.globalAlpha = glowAlpha * 0.3;
  glow.fillStyle = "rgba(151, 216, 231, 0.2)";
  glow.beginPath();
  glow.ellipse(
    sphereCenter.x,
    sphereCenter.y,
    clamp(sphereRadius * 1.6, 8, 82),
    clamp(sphereRadius * 1.45, 8, 76),
    0,
    0,
    TAU,
  );
  glow.fill();
  glow.restore();

  const beacon = projectedPoint(options, instance, 82, totalHeight);
  options.glowDot(
    beacon.x,
    beacon.y,
    clamp(heightPixels * 0.04, 3, 11),
    rgba(239, 47, 38, instance.alpha * 0.46),
  );
}

/**
 * Draws recurring Tokyo landmarks in world-space order. The caller owns both
 * contexts and should clear/composite its glow layer around this call.
 */
export function drawProceduralLandmark(
  context: LandmarkDrawContext,
  glow: LandmarkDrawContext,
  options: ProceduralLandmarkOptions,
  landmark: ProceduralLandmarkInstance,
): void {
  context.save();
  glow.save();
  const distanceBrightness = lerp(0.04, 1, landmark.alpha);
  context.filter = `brightness(${distanceBrightness})`;
  glow.filter = `brightness(${distanceBrightness})`;
  if (landmark.kind === "tokyo-tower") {
    drawTokyoTower(context, glow, options, landmark);
  } else if (landmark.kind === "skytree") {
    drawSkytree(context, glow, options, landmark);
  } else if (landmark.kind === "tokyo-metropolitan-government") {
    drawTokyoMetropolitanGovernment(context, glow, options, landmark);
  } else if (landmark.kind === "toranomon-hills") {
    drawToranomonHills(context, glow, options, landmark);
  } else if (landmark.kind === "shibuya-scramble-square") {
    drawShibuyaScrambleSquare(context, glow, options, landmark);
  } else if (landmark.kind === "cocoon-tower") {
    drawCocoonTower(context, glow, options, landmark);
  } else if (landmark.kind === "fuji-television") {
    drawFujiTelevision(context, glow, options, landmark);
  } else if (landmark.kind === "rainbow-bridge") {
    drawRainbowBridge(context, glow, options, landmark);
  } else if (landmark.kind === "big-sight") {
    drawBigSight(context, glow, options, landmark);
  } else {
    drawHarborCranes(context, glow, options, landmark);
  }
  glow.restore();
  context.restore();
}

export function drawProceduralLandmarks(
  context: LandmarkDrawContext,
  glow: LandmarkDrawContext,
  options: ProceduralLandmarkOptions,
): void {
  if (
    !Number.isFinite(options.totalDistanceMeters) ||
    !Number.isFinite(options.sceneLength) ||
    options.sceneLength <= 0 ||
    options.cssWidth <= 0 ||
    options.cssHeight <= 0
  ) {
    return;
  }

  const landmarks = collectProceduralLandmarks(options);
  for (const landmark of landmarks) {
    drawProceduralLandmark(context, glow, options, landmark);
  }
}
