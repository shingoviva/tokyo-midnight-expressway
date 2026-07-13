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

type LandmarkKind =
  | "tokyo-tower"
  | "skytree"
  | "rainbow-bridge"
  | "big-sight"
  | "harbor-cranes";

type LandmarkSpec = Readonly<{
  kind: LandmarkKind;
  phase: number;
  lateral: number;
  salt: number;
  maximumDistance: number;
}>;

type LandmarkInstance = Readonly<{
  kind: LandmarkKind;
  z: number;
  lateral: number;
  block: number;
  alpha: number;
}>;

const TAU = Math.PI * 2;

const LANDMARK_SPECS: readonly LandmarkSpec[] = [
  {
    kind: "skytree",
    phase: 0.25,
    lateral: 104,
    salt: 211,
    maximumDistance: 1520,
  },
  {
    kind: "rainbow-bridge",
    phase: 0.679,
    lateral: 10,
    salt: 307,
    maximumDistance: 1390,
  },
  {
    kind: "big-sight",
    phase: 0.604,
    lateral: 72,
    salt: 419,
    maximumDistance: 1260,
  },
  {
    kind: "harbor-cranes",
    phase: 0.75,
    lateral: 84,
    salt: 503,
    maximumDistance: 1320,
  },
  {
    kind: "tokyo-tower",
    phase: 0.321,
    lateral: 78,
    salt: 617,
    maximumDistance: 1480,
  },
] as const;

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

function projectedPoint(
  options: ProceduralLandmarkOptions,
  instance: LandmarkInstance,
  lateralOffset: number,
  height: number,
  zOffset = 0,
): ScreenPoint {
  const point = options.project(
    instance.z + zOffset,
    instance.lateral + lateralOffset,
    height,
  );
  return { x: point.x, y: point.y };
}

function projectedScale(
  options: ProceduralLandmarkOptions,
  instance: LandmarkInstance,
): number {
  return options.project(instance.z, instance.lateral, 0).scale;
}

function projectedHeight(
  options: ProceduralLandmarkOptions,
  instance: LandmarkInstance,
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

function landmarkVisibility(z: number, maximumDistance: number): number {
  const nearFade = smoothstep(38, 118, z);
  const farFade = 1 - smoothstep(maximumDistance - 310, maximumDistance, z);
  const atmosphere = lerp(0.48, 0.98, 1 - clamp(z / maximumDistance, 0, 1));
  return nearFade * farFade * atmosphere;
}

function collectLandmarks(
  options: ProceduralLandmarkOptions,
): LandmarkInstance[] {
  const instances: LandmarkInstance[] = [];
  const sceneLength = Math.max(2400, options.sceneLength);

  for (const spec of LANDMARK_SPECS) {
    const anchor = sceneLength * spec.phase;
    const firstBlock = Math.floor(
      (options.totalDistanceMeters + 32 - anchor) / sceneLength,
    );
    const lastBlock = Math.ceil(
      (options.totalDistanceMeters + spec.maximumDistance - anchor) / sceneLength,
    );

    for (let block = firstBlock; block <= lastBlock; block += 1) {
      const world = block * sceneLength + anchor;
      const z = world - options.totalDistanceMeters;
      if (z <= 28 || z >= spec.maximumDistance) continue;

      const side = (hashInteger(block + spec.salt) & 1) === 0 ? -1 : 1;
      const jitter = (seeded(block, spec.salt + 17) - 0.5) * 18;
      instances.push({
        kind: spec.kind,
        z,
        lateral: side * (spec.lateral + jitter),
        block,
        alpha: landmarkVisibility(z, spec.maximumDistance),
      });
    }
  }

  instances.sort((first, second) => second.z - first.z);
  return instances;
}

function isPotentiallyVisible(
  options: ProceduralLandmarkOptions,
  instance: LandmarkInstance,
  heightMeters: number,
  halfWidthMeters: number,
): boolean {
  const base = options.project(instance.z, instance.lateral, 0);
  const top = options.project(instance.z, instance.lateral, heightMeters);
  const halfWidth = halfWidthMeters * base.scale;
  const margin = Math.max(80, halfWidth * 0.3);
  return (
    Math.abs(base.groundY - top.y) >= 2.2 &&
    base.x + halfWidth >= -margin &&
    base.x - halfWidth <= options.cssWidth + margin &&
    top.y <= options.cssHeight + margin &&
    base.groundY >= -margin
  );
}

function towerHalfWidth(height: number): number {
  if (height <= 63) return lerp(18.5, 8.1, height / 63);
  if (height <= 112) return lerp(8.1, 3.1, (height - 63) / 49);
  return lerp(3.1, 1.25, clamp((height - 112) / 24, 0, 1));
}

function drawTokyoTower(
  context: LandmarkDrawContext,
  glow: LandmarkDrawContext,
  options: ProceduralLandmarkOptions,
  instance: LandmarkInstance,
): void {
  const totalHeight = 170;
  if (!isPotentiallyVisible(options, instance, totalHeight, 21)) return;

  const scale = projectedScale(options, instance);
  const heightPixels = projectedHeight(options, instance, totalHeight);
  const detailAlpha = smoothstep(34, 108, heightPixels);
  const fineAlpha = smoothstep(76, 190, heightPixels);
  const landmarkAlpha = context.globalAlpha * instance.alpha;
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

  drawDeck(62, 9.7, 6.7);
  drawDeck(105, 5.1, 4.2);

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
  instance: LandmarkInstance,
): void {
  const totalHeight = 216;
  if (!isPotentiallyVisible(options, instance, totalHeight, 22)) return;

  const scale = projectedScale(options, instance);
  const heightPixels = projectedHeight(options, instance, totalHeight);
  const detailAlpha = smoothstep(42, 124, heightPixels);
  const fineAlpha = smoothstep(88, 210, heightPixels);
  const landmarkAlpha = context.globalAlpha * instance.alpha;
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

  drawObservationDeck(116, 7.4, 3.1);
  drawObservationDeck(144, 5.3, 2.5);

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
  instance: LandmarkInstance,
): void {
  const totalHeight = 66;
  const halfSpan = 91;
  if (!isPotentiallyVisible(options, instance, totalHeight, halfSpan)) return;

  const scale = projectedScale(options, instance);
  const heightPixels = projectedHeight(options, instance, totalHeight);
  const detailAlpha = smoothstep(30, 88, heightPixels);
  const fineAlpha = smoothstep(62, 148, heightPixels);
  const landmarkAlpha = context.globalAlpha * instance.alpha;
  const glowAlpha = glow.globalAlpha * instance.alpha;
  const towerCenters = [-45, 45] as const;
  const deckBottom = 12;
  const deckTop = 16.5;

  context.save();
  context.globalAlpha = landmarkAlpha;
  context.lineCap = "round";
  context.lineJoin = "round";

  context.fillStyle = "rgba(18, 28, 34, 0.96)";
  fillPolygon(context, [
    projectedPoint(options, instance, -halfSpan, deckBottom, 3.5),
    projectedPoint(options, instance, halfSpan, deckBottom, 3.5),
    projectedPoint(options, instance, halfSpan, deckTop, 3.5),
    projectedPoint(options, instance, -halfSpan, deckTop, 3.5),
  ]);
  context.fillStyle = "rgba(75, 91, 99, 0.94)";
  fillPolygon(context, [
    projectedPoint(options, instance, -halfSpan, deckTop),
    projectedPoint(options, instance, halfSpan, deckTop),
    projectedPoint(options, instance, halfSpan, deckTop + 2.2),
    projectedPoint(options, instance, -halfSpan, deckTop + 2.2),
  ]);
  context.strokeStyle = "rgba(181, 205, 214, 0.76)";
  context.lineWidth = clamp(scale * 0.25, 0.55, 2.4);
  strokePolyline(context, [
    projectedPoint(options, instance, -halfSpan, deckTop + 2.2),
    projectedPoint(options, instance, halfSpan, deckTop + 2.2),
  ]);

  const drawTower = (center: number, zOffset: number, rear: boolean): void => {
    const color = rear
      ? "rgba(93, 114, 122, 0.8)"
      : "rgba(171, 195, 202, 0.96)";
    context.fillStyle = color;
    for (const side of [-1, 1] as const) {
      const outside = center + side * 5.1;
      fillPolygon(context, [
        projectedPoint(options, instance, outside - side * 1.25, deckTop, zOffset),
        projectedPoint(options, instance, outside - side * 0.7, 62, zOffset),
        projectedPoint(options, instance, outside + side * 0.7, 62, zOffset),
        projectedPoint(options, instance, outside + side * 1.25, deckTop, zOffset),
      ]);
    }
    context.strokeStyle = rear
      ? "rgba(126, 151, 160, 0.58)"
      : "rgba(218, 234, 237, 0.9)";
    context.lineWidth = clamp(scale * 0.72, 0.7, 4.4);
    for (const height of [33, 48, 61]) {
      strokePolyline(context, [
        projectedPoint(options, instance, center - 5.2, height, zOffset),
        projectedPoint(options, instance, center + 5.2, height, zOffset),
      ]);
    }
  };

  for (const center of towerCenters) drawTower(center, 4.5, true);
  for (const center of towerCenters) drawTower(center, 0, false);

  const cableHeight = (x: number): number => {
    const absolute = Math.abs(x);
    if (absolute <= 45) {
      const normalized = absolute / 45;
      return 25 + 36 * normalized * normalized;
    }
    return lerp(61, 20, clamp((absolute - 45) / (halfSpan - 45), 0, 1));
  };

  context.globalAlpha = landmarkAlpha * detailAlpha;
  context.strokeStyle = "rgba(205, 224, 229, 0.92)";
  context.lineWidth = clamp(scale * 0.62, 0.7, 3.8);
  const cablePoints: ScreenPoint[] = [];
  const cableSamples = detailLevel(options.quality, 14, 20, 28);
  for (let index = 0; index <= cableSamples; index += 1) {
    const x = lerp(-halfSpan, halfSpan, index / cableSamples);
    cablePoints.push(projectedPoint(options, instance, x, cableHeight(x)));
  }
  strokePolyline(context, cablePoints);

  context.globalAlpha = landmarkAlpha * fineAlpha;
  context.strokeStyle = "rgba(168, 199, 208, 0.72)";
  context.lineWidth = clamp(scale * 0.2, 0.45, 1.4);
  const hangerSpacing = detailLevel(options.quality, 13, 9, 6.5);
  for (let x = -83; x <= 83; x += hangerSpacing) {
    strokePolyline(context, [
      projectedPoint(options, instance, x, deckTop + 2.2),
      projectedPoint(options, instance, x, cableHeight(x)),
    ]);
  }

  context.fillStyle = "rgba(206, 235, 241, 0.9)";
  const lightSpacing = detailLevel(options.quality, 24, 18, 14);
  for (let x = -82; x <= 82; x += lightSpacing) {
    const light = projectedPoint(options, instance, x, deckTop + 2.8);
    context.beginPath();
    context.arc(light.x, light.y, clamp(scale * 0.28, 0.55, 1.8), 0, TAU);
    context.fill();
  }
  context.restore();

  glow.save();
  glow.globalAlpha = glowAlpha * 0.4;
  glow.strokeStyle = "rgba(126, 205, 229, 0.28)";
  glow.lineWidth = clamp(scale * 2.1, 2, 13);
  strokePolyline(glow, cablePoints);
  glow.restore();

  for (const center of towerCenters) {
    const beacon = projectedPoint(options, instance, center, 63);
    options.glowDot(
      beacon.x,
      beacon.y,
      clamp(scale * 3.1, 3, 16),
      rgba(240, 45, 39, instance.alpha * 0.5),
    );
  }
}

function drawBigSight(
  context: LandmarkDrawContext,
  glow: LandmarkDrawContext,
  options: ProceduralLandmarkOptions,
  instance: LandmarkInstance,
): void {
  const totalHeight = 50;
  if (!isPotentiallyVisible(options, instance, totalHeight, 53)) return;

  const scale = projectedScale(options, instance);
  const heightPixels = projectedHeight(options, instance, totalHeight);
  const detailAlpha = smoothstep(28, 82, heightPixels);
  const fineAlpha = smoothstep(56, 138, heightPixels);
  const landmarkAlpha = context.globalAlpha * instance.alpha;
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
  instance: LandmarkInstance,
): void {
  const totalHeight = 59;
  if (!isPotentiallyVisible(options, instance, totalHeight, 76)) return;

  const groupHeightPixels = projectedHeight(options, instance, totalHeight);
  const detailAlpha = smoothstep(26, 76, groupHeightPixels);
  const fineAlpha = smoothstep(54, 132, groupHeightPixels);
  const landmarkAlpha = context.globalAlpha * instance.alpha;
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
    const craneScale = options.project(
      instance.z + zOffset,
      instance.lateral + lateralOffset,
      0,
    ).scale;
    const height = 45 + seeded(seed, 733) * 11;
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

/**
 * Draws recurring Tokyo landmarks in world-space order. The caller owns both
 * contexts and should clear/composite its glow layer around this call.
 */
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

  const landmarks = collectLandmarks(options);
  for (const landmark of landmarks) {
    if (landmark.alpha <= 0.002) continue;
    if (landmark.kind === "tokyo-tower") {
      drawTokyoTower(context, glow, options, landmark);
    } else if (landmark.kind === "skytree") {
      drawSkytree(context, glow, options, landmark);
    } else if (landmark.kind === "rainbow-bridge") {
      drawRainbowBridge(context, glow, options, landmark);
    } else if (landmark.kind === "big-sight") {
      drawBigSight(context, glow, options, landmark);
    } else {
      drawHarborCranes(context, glow, options, landmark);
    }
  }
}
