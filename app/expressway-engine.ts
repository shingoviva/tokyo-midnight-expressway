import {
  createProceduralAssets,
  type ProceduralSignSprite,
} from "./procedural-assets";
import {
  sampleDriveDirector,
  type DriveDirectorState,
} from "./drive-director";
import {
  isRoadsideSignBlockedByTallWall,
  roadsideSoundBarrierHeight,
} from "./roadside-layout";
import {
  advancePassingLateral,
  advanceOvertakeMotion,
  avoidanceLaneBlockedByVehicle,
  OVERTAKE_LANE_OFFSET_METERS,
  roadObstacleRequiresAvoidance,
  safeOvertakeTargetAgainstVehicle,
  safeRoadObstacleFollowingZ,
  selectPassingLane,
  smoothPassingLateral,
} from "./traffic-encounters";
import {
  collectProceduralLandmarks,
  collectProceduralLandmarkSites,
  drawProceduralLandmark,
  type ProceduralLandmarkInstance,
  type ProceduralLandmarkOptions,
} from "./procedural-landmarks";

export type Telemetry = {
  speedKmh: number;
  distanceKm: number;
  routeName: string;
  sceneName: string;
  fps: number;
  quality: "HIGH" | "BALANCED" | "MOBILE";
};

export type ExpresswayEngine = {
  start(): void;
  destroy(): void;
  setPaused(paused: boolean): void;
  togglePaused(): boolean;
  setSpeedKmh(speedKmh: number): number;
  getSpeedKmh(): number;
  toggleSound(): Promise<boolean>;
  setSoundEnabled(enabled: boolean): Promise<boolean>;
  isSoundEnabled(): boolean;
};

type DrawContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

type DrawingLayer = {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  context: DrawContext;
};

type RoadPoint = {
  z: number;
  world: number;
  center: number;
  y: number;
  scale: number;
};

type ProjectedPoint = {
  x: number;
  y: number;
  groundY: number;
  scale: number;
};

type VehicleKind = "sedan" | "minivan" | "truck";
type VehicleRole = "ambient" | "taxi" | "merging-truck" | "maintenance";

type TrafficVehicle = {
  id: number;
  z: number;
  lane: -1 | 1;
  closingSpeed: number;
  kind: VehicleKind;
  shade: number;
  generation: number;
  role: VehicleRole;
  lanePosition?: number;
  signalSide?: -1 | 1;
  laneChangeFrom?: -1 | 1;
  laneChangeTo?: -1 | 1;
  laneChangeStartZ?: number;
  laneChangeEndZ?: number;
  avoidanceFromLateral?: number;
  avoidanceToLateral?: number;
  avoidanceProgress?: number;
  avoidanceDuration?: number;
};

type SceneObject =
  | { kind: "light"; z: number; index: number; side: -1 | 1 }
  | { kind: "sign"; z: number; index: number }
  | { kind: "overpass"; z: number; index: number; level: number }
  | { kind: "emergency-unit"; z: number; index: number; side: -1 | 1 }
  | { kind: "bollard"; z: number; index: number; side: -1 | 1 }
  | { kind: "vehicle"; z: number; vehicle: TrafficVehicle };

type CityLayerItem =
  | { kind: "building"; z: number; index: number; side: -1 | 1 }
  | { kind: "landmark"; z: number; landmark: ProceduralLandmarkInstance }
  | {
      kind: "elevated";
      z: number;
      spec: ElevatedSpanSpec;
      block: number;
      nearWorld: number;
      farWorld: number;
    }
  | {
      kind: "elevated-pier";
      z: number;
      spec: ElevatedSpanSpec;
      block: number;
      world: number;
      terminal: boolean;
    };

type DepthSceneItem =
  | { source: "city"; z: number; item: CityLayerItem }
  | { source: "road"; z: number; object: SceneObject };

type ElevatedSpanSpec = {
  level: 0 | 1;
  drawStart: number;
  coreStart: number;
  coreEnd: number;
  drawEnd: number;
  coreOffset: number;
  terminalSide: -1 | 1;
  heightMeters: number;
  halfWidthMeters: number;
  curvePhase: number;
};

type BuildingFootprint = {
  location: number;
  occupancy: number;
  openWaterfront: boolean;
  closeCanyon: boolean;
  widthMeters: number;
  lateral: number;
};

type AudioRig = {
  context: AudioContext;
  master: GainNode;
  engineGain: GainNode;
  engineOscillator: OscillatorNode;
  subOscillator: OscillatorNode;
  engineFilter: BiquadFilterNode;
  roadGain: GainNode;
  roadNoise: AudioBufferSourceNode;
  roadFilter: BiquadFilterNode;
};

const TAU = Math.PI * 2;
const CAMERA_HEIGHT = 1.34;
// Two 3.25 m lanes plus compact urban-expressway shoulders.
const ROAD_HALF_WIDTH = 3.7;
const FAR_DISTANCE = 1800;
// Transverse overpasses are introduced before the road mesh reaches its far
// plane. They can therefore become fully opaque behind the skyline before any
// support is large enough to read as a distinct object.
const OVERPASS_FAR_DISTANCE = FAR_DISTANCE + 560;
const CITY_FAR_DISTANCE = 2800;
const NEAR_DISTANCE = 0.12;
const LOCATION_LENGTH = 700;
const LOCATION_NAMES = [
  "丸の内オフィスキャニオン",
  "箱崎多層ジャンクション",
  "C2・冷白灯防音壁区間",
  "神田川ローライズ",
  "芝公園・東京タワー",
  "銀座アドバータイジング",
  "汐留ガラススカイライン",
  "麻布台・高層街",
  "有明ウォーターフロント",
  "レインボーブリッジ進入",
  "湾岸倉庫・港湾クレーン",
  "工事規制付きロングカーブ",
  "渋谷トンネルアプローチ",
  "台場ナイトスカイライン",
] as const;
const SCENE_LENGTH = LOCATION_LENGTH * LOCATION_NAMES.length;
const LIGHT_SPACING = 36;
const SIGN_SPACING = 560;
const MAX_LIGHT_TRAIL_HISTORY = 96;

// Longitudinal decks use real-world meter ranges. Their approaches continue
// beyond the visible core, descend and curve behind the city instead of ending
// in mid-air.
const ELEVATED_SPAN_SPECS: readonly ElevatedSpanSpec[] = [
  { level: 0, drawStart: 535, coreStart: 705, coreEnd: 1395, drawEnd: 1575, coreOffset: 24, terminalSide: 1, heightMeters: 8.6, halfWidthMeters: 4.45, curvePhase: 0.15 },
  { level: 1, drawStart: 625, coreStart: 790, coreEnd: 1310, drawEnd: 1475, coreOffset: -30, terminalSide: -1, heightMeters: 14.2, halfWidthMeters: 4.25, curvePhase: 0.61 },
  { level: 0, drawStart: 6205, coreStart: 6385, coreEnd: 6950, drawEnd: 7130, coreOffset: -25, terminalSide: -1, heightMeters: 9.4, halfWidthMeters: 4.5, curvePhase: 0.34 },
  { level: 0, drawStart: 8230, coreStart: 8405, coreEnd: 9095, drawEnd: 9275, coreOffset: 24, terminalSide: 1, heightMeters: 8.8, halfWidthMeters: 4.45, curvePhase: 0.82 },
  { level: 1, drawStart: 8395, coreStart: 8565, coreEnd: 8945, drawEnd: 9115, coreOffset: -31, terminalSide: -1, heightMeters: 14.4, halfWidthMeters: 4.25, curvePhase: 0.47 },
];
const OVERPASS_ANCHORS = [865, 1120, 2485, 4580, 5180, 8565, 8840] as const;

const ROUTE_NAMES = [
  "C1 都心環状線",
  "11号 台場線",
  "湾岸線 B",
  "C2 中央環状線",
] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
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

let retainedSessionSeed: number | null = null;
let retainedStartLocation: number | null = null;

function createSessionSeed(): number {
  if (retainedSessionSeed !== null) return retainedSessionSeed;
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const entropy = new Uint32Array(1);
    crypto.getRandomValues(entropy);
    retainedSessionSeed = entropy[0] & 0x7fffffff;
    return retainedSessionSeed;
  }
  retainedSessionSeed = hashInteger(
    Date.now() ^ Math.floor(performance.now() * 1000),
  );
  return retainedSessionSeed;
}

function createSessionStartLocation(sessionSeed: number): number {
  if (retainedStartLocation !== null) return retainedStartLocation;
  let location = Math.floor(seeded(sessionSeed, 8_401) * LOCATION_NAMES.length);
  try {
    const previous = Number.parseInt(
      sessionStorage.getItem("after-midnight:last-start-location") ?? "-1",
      10,
    );
    if (location === previous) {
      const offset =
        1 + Math.floor(seeded(sessionSeed, 8_409) * (LOCATION_NAMES.length - 1));
      location = positiveModulo(location + offset, LOCATION_NAMES.length);
    }
    sessionStorage.setItem(
      "after-midnight:last-start-location",
      String(location),
    );
  } catch {
    // Storage can be unavailable in private browsing; entropy still varies.
  }
  retainedStartLocation = location;
  return location;
}

function periodicPhase(distance: number, period: number, offset = 0): number {
  return (positiveModulo(distance + offset, period) / period) * TAU;
}

function pathCenter(distance: number): number {
  return (
    Math.sin(periodicPhase(distance, 1960, 170)) * 57 +
    Math.sin(periodicPhase(distance, 820, 410)) * 19 +
    Math.sin(periodicPhase(distance, 337, 80)) * 4.5
  );
}

function pathTangent(distance: number): number {
  return (
    Math.cos(periodicPhase(distance, 1960, 170)) * (57 * TAU) / 1960 +
    Math.cos(periodicPhase(distance, 820, 410)) * (19 * TAU) / 820 +
    Math.cos(periodicPhase(distance, 337, 80)) * (4.5 * TAU) / 337
  );
}

function pathElevation(distance: number): number {
  return (
    Math.sin(periodicPhase(distance, 1830, 260)) * 5.8 +
    Math.sin(periodicPhase(distance, 690, 510)) * 1.6
  );
}

function pathElevationTangent(distance: number): number {
  return (
    Math.cos(periodicPhase(distance, 1830, 260)) * (5.8 * TAU) / 1830 +
    Math.cos(periodicPhase(distance, 690, 510)) * (1.6 * TAU) / 690
  );
}

function locationIndex(distance: number): number {
  return positiveModulo(
    Math.floor(distance / LOCATION_LENGTH),
    LOCATION_NAMES.length,
  );
}

function locationLocal(distance: number): number {
  return positiveModulo(distance, LOCATION_LENGTH);
}

function soundBarrierHeightAt(
  world: number,
  side: -1 | 1,
): number {
  return roadsideSoundBarrierHeight(
    world,
    side,
    LOCATION_LENGTH,
    LOCATION_NAMES.length,
  );
}

function roadsideSignBlockedByTallWall(
  world: number,
  side: -1 | 1,
): boolean {
  return isRoadsideSignBlockedByTallWall(
    world,
    side,
    LOCATION_LENGTH,
    LOCATION_NAMES.length,
  );
}

function farFade(distance: number, start: number, end: number): number {
  return 1 - smoothstep(start, end, distance);
}

function fillPolygon(
  context: DrawContext,
  points: ReadonlyArray<readonly [number, number]>,
): void {
  if (points.length < 3) return;
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index][0], points[index][1]);
  }
  context.closePath();
  context.fill();
}

function createDrawingLayer(width = 1, height = 1): DrawingLayer {
  if (typeof OffscreenCanvas !== "undefined") {
    const surface = new OffscreenCanvas(width, height);
    const context = surface.getContext("2d");
    if (!context) throw new Error("Offscreen 2D canvas is unavailable.");
    return { canvas: surface, context };
  }

  const surface = document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  const context = surface.getContext("2d");
  if (!context) throw new Error("Offscreen 2D canvas is unavailable.");
  return { canvas: surface, context };
}

function resizeDrawingLayer(
  layer: DrawingLayer,
  width: number,
  height: number,
): void {
  layer.canvas.width = Math.max(1, Math.round(width));
  layer.canvas.height = Math.max(1, Math.round(height));
}

export function createExpresswayEngine(
  canvas: HTMLCanvasElement,
  onTelemetry: (telemetry: Telemetry) => void = () => undefined,
): ExpresswayEngine {
  const mainContext = canvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
  });

  if (!mainContext) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  const context = mainContext;
  const sessionSeed = createSessionSeed();
  const sessionStartLocation = createSessionStartLocation(sessionSeed);
  const sessionStartProgress =
    72 + seeded(sessionSeed, 8_417) * (LOCATION_LENGTH - 164);
  const sessionStartMeters =
    sessionStartLocation * LOCATION_LENGTH + sessionStartProgress;
  const glowLayer = createDrawingLayer();
  const noiseLayer = createDrawingLayer(128, 128);
  const proceduralAssets = createProceduralAssets();
  const advertisingSigns = proceduralAssets.signs.filter(
    (sign) => sign.family.startsWith("advertising"),
  );
  const roadSigns = proceduralAssets.signs.filter(
    (sign) => !sign.family.startsWith("advertising"),
  );
  const asphaltPattern = context.createPattern(
    proceduralAssets.surfaces.asphalt,
    "repeat",
  );
  const concretePattern = context.createPattern(
    proceduralAssets.surfaces.concrete,
    "repeat",
  );
  const metalPattern = context.createPattern(
    proceduralAssets.surfaces.metal,
    "repeat",
  );

  let cssWidth = 1;
  let cssHeight = 1;
  let pixelRatio = 1;
  let glowRatio = 0.5;
  let focalLength = 1;
  let horizon = 1;
  let quality: Telemetry["quality"] = "HIGH";
  let noisePattern: CanvasPattern | null = null;
  let noiseImageData: ImageData | null = null;
  let skyGradientCache: CanvasGradient | null = null;
  let horizonHazeCache: CanvasGradient | null = null;
  let leftHeadlightWashCache: CanvasGradient | null = null;
  let rightHeadlightWashCache: CanvasGradient | null = null;
  let roadSheenCache: CanvasGradient | null = null;
  let distanceFogCache: CanvasGradient | null = null;
  let vignetteCache: CanvasGradient | null = null;

  let started = false;
  let destroyed = false;
  let paused = false;
  let hidden = typeof document !== "undefined" ? document.hidden : false;
  let animationFrame = 0;
  let lastFrameTime = 0;
  let lastTelemetryTime = -Infinity;
  let elapsedTime = 0;
  let totalDistanceMeters = sessionStartMeters;
  const qaJourneyStartMeters = import.meta.env.DEV
    ? Math.max(
        0,
        Number(new URLSearchParams(window.location.search).get("qaDistance")) ||
          0,
      )
    : 0;
  let journeyDistanceMeters = qaJourneyStartMeters;
  const qaSpeedKmh = import.meta.env.DEV
    ? Number(new URLSearchParams(window.location.search).get("qaSpeed"))
    : Number.NaN;
  let speedKmh = Number.isFinite(qaSpeedKmh)
    ? clamp(qaSpeedKmh, 30, 180)
    : 82;
  let smoothedFps = 60;
  let frameNumber = 0;
  let soundEnabled = false;
  let audioRig: AudioRig | null = null;
  let audioUpdateTime = 0;
  let resizeObserver: ResizeObserver | null = null;
  let directorState: DriveDirectorState = sampleDriveDirector(
    journeyDistanceMeters,
    sessionSeed,
  );

  function signGlowColor(family: string, alpha = 0.12): string {
    if (family.startsWith("led")) return `rgba(255, 121, 31, ${alpha * 1.45})`;
    if (family.startsWith("lane-control")) return `rgba(82, 238, 199, ${alpha})`;
    if (family.startsWith("blue")) return `rgba(86, 192, 242, ${alpha})`;
    if (family.includes("amber") || family.includes("orange")) {
      return `rgba(255, 139, 48, ${alpha})`;
    }
    if (family.includes("red")) return `rgba(255, 65, 84, ${alpha})`;
    if (family.includes("indigo") || family.includes("violet")) {
      return `rgba(148, 107, 255, ${alpha})`;
    }
    if (family.includes("lime")) return `rgba(203, 255, 67, ${alpha})`;
    if (family.includes("monochrome") || family.includes("white")) {
      return `rgba(190, 239, 236, ${alpha})`;
    }
    if (family.includes("magenta")) return `rgba(255, 82, 193, ${alpha})`;
    if (family.startsWith("advertising")) return `rgba(72, 208, 242, ${alpha})`;
    return `rgba(61, 165, 127, ${alpha})`;
  }

  function selectSignMipmap(
    sign: ProceduralSignSprite,
    projectedWidth: number,
    projectedHeight: number,
  ): CanvasImageSource {
    const projectedMax = Math.max(projectedWidth, projectedHeight) * pixelRatio;
    const desiredSourceMax = clamp(projectedMax * 2.25, 16, 1024);
    const level = clamp(
      Math.round(Math.log2(1024 / desiredSourceMax)),
      0,
      sign.mipmaps.length - 1,
    );
    return sign.mipmaps[level] ?? sign.canvas;
  }

  const roadPoints: RoadPoint[] = [];
  const sceneObjects: SceneObject[] = [];
  const cityLayerItems: CityLayerItem[] = [];
  const depthSceneItems: DepthSceneItem[] = [];
  const vehicles: TrafficVehicle[] = [];
  const lightTrailPositions = new Map<
    number,
    { x: number; y: number; frame: number }
  >();

  function vehicleDimensions(kind: VehicleKind): {
    width: number;
    height: number;
  } {
    return kind === "truck"
      ? { width: 2.42, height: 3.45 }
      : kind === "minivan"
        ? { width: 1.9, height: 1.72 }
        : { width: 1.82, height: 1.35 };
  }

  function safeVehicleLanePosition(
    vehicle: Pick<TrafficVehicle, "kind">,
    requestedPosition: number,
  ): number {
    const dimensions = vehicleDimensions(vehicle.kind);
    const maximumCenter = ROAD_HALF_WIDTH - dimensions.width * 0.5 - 0.24;
    return clamp(requestedPosition, -maximumCenter, maximumCenter);
  }

  function scheduleAmbientManeuver(
    vehicle: TrafficVehicle,
    seed: number,
  ): void {
    vehicle.laneChangeFrom = undefined;
    vehicle.laneChangeTo = undefined;
    vehicle.laneChangeStartZ = undefined;
    vehicle.laneChangeEndZ = undefined;
    if (seeded(seed, 397) < 0.44 || vehicle.z < 115) return;

    const maximumStartZ = Math.min(vehicle.z - 18, 1_360);
    const minimumStartZ = Math.min(maximumStartZ, 115);
    const startZ = lerp(
      minimumStartZ,
      maximumStartZ,
      seeded(seed, 401),
    );
    const durationZ = 34 + seeded(seed, 409) * 52;
    vehicle.laneChangeFrom = vehicle.lane;
    vehicle.laneChangeTo = vehicle.lane === 1 ? -1 : 1;
    vehicle.laneChangeStartZ = startZ;
    vehicle.laneChangeEndZ = Math.max(24, startZ - durationZ);
  }

  const initialVehicleCount = 20;
  const initialVehicleSpacing = lerp(82, 52, directorState.intensity);
  for (let index = 0; index < initialVehicleCount; index += 1) {
    const vehicleSeed = index + sessionSeed;
    const kindRoll = seeded(vehicleSeed, 91);
    const vehicle: TrafficVehicle = {
      id: index,
      z: 46 + index * initialVehicleSpacing + seeded(vehicleSeed, 17) * 38,
      lane: seeded(vehicleSeed, 41) > 0.5 ? 1 : -1,
      closingSpeed: 0.55 + seeded(vehicleSeed, 29) * 1.65,
      kind: kindRoll > 0.84 ? "truck" : kindRoll > 0.6 ? "minivan" : "sedan",
      shade: seeded(vehicleSeed, 53),
      generation: 0,
      role: "ambient",
    };
    scheduleAmbientManeuver(vehicle, vehicleSeed * 173);
    vehicles.push(vehicle);
  }

  // Reused for every scripted encounter. The director mutates this single
  // instance instead of allocating event traffic on every animation frame.
  const eventVehicle: TrafficVehicle = {
    id: 100_000,
    z: FAR_DISTANCE,
    lane: 1,
    closingSpeed: 0,
    kind: "sedan",
    shade: 0.1,
    generation: 0,
    role: "taxi",
    lanePosition: 1.72,
  };
  let taxiEncounterActive = false;
  let taxiVisualZ = 0.05;
  let taxiLongitudinalVelocity = 0;
  let taxiLastUpdateTime = 0;
  let taxiLanePosition = OVERTAKE_LANE_OFFSET_METERS;
  let taxiTargetLanePosition = OVERTAKE_LANE_OFFSET_METERS;
  let taxiLaneVelocity = 0;
  let taxiLastLaneDecisionProgress = Number.NEGATIVE_INFINITY;
  const taxiTrafficSamples: Array<{
    z: number;
    lateral: number;
    kind: VehicleKind;
  }> = vehicles.map((vehicle) => ({
    z: vehicle.z,
    lateral: vehicle.lane * OVERTAKE_LANE_OFFSET_METERS,
    kind: vehicle.kind,
  }));
  const ambientTrafficOrder = [...vehicles];

  function transformGroundPattern(
    pattern: CanvasPattern,
    far: RoadPoint,
    near: RoadPoint,
    farCenter: number,
    farY: number,
    nearCenter: number,
    nearY: number,
    sourceWidth: number,
    sourceHeight: number,
    tileWidthMeters: number,
    tileLengthMeters: number,
  ): void {
    const worldSpan = Math.max(0.001, far.world - near.world);
    const imageSpan = Math.max(
      0.001,
      (worldSpan / tileLengthMeters) * sourceHeight,
    );
    const tileStart =
      Math.floor(near.world / tileLengthMeters) * tileLengthMeters;
    const startMix = (tileStart - near.world) / worldSpan;
    const anchorCenter = lerp(nearCenter, farCenter, startMix);
    const anchorY = lerp(nearY, farY, startMix);
    const averageScale = (near.scale + far.scale) * 0.5;
    const scaleX = (tileWidthMeters * averageScale) / sourceWidth;

    pattern.setTransform({
      a: scaleX,
      b: 0,
      c: (farCenter - nearCenter) / imageSpan,
      d: (farY - nearY) / imageSpan,
      e: anchorCenter - scaleX * sourceWidth * 0.5,
      f: anchorY,
    });
  }

  function transformWallPattern(
    pattern: CanvasPattern,
    far: RoadPoint,
    near: RoadPoint,
    side: -1 | 1,
    sourceWidth: number,
    sourceHeight: number,
    wallHeightMeters: number,
    tileLengthMeters: number,
    tileHeightMeters: number,
  ): void {
    const lateral = side * (ROAD_HALF_WIDTH + 0.72);
    const farX = far.center + lateral * far.scale;
    const nearX = near.center + lateral * near.scale;
    const worldSpan = Math.max(0.001, far.world - near.world);
    const farTop = far.y - wallHeightMeters * far.scale;
    const nearTop = near.y - wallHeightMeters * near.scale;
    const xPerMeter = (farX - nearX) / worldSpan;
    const yPerMeter = (farTop - nearTop) / worldSpan;
    const tileStart =
      Math.floor(near.world / tileLengthMeters) * tileLengthMeters;
    const startOffset = tileStart - near.world;
    const averageScale = (near.scale + far.scale) * 0.5;

    pattern.setTransform({
      a: (xPerMeter * tileLengthMeters) / sourceWidth,
      b: (yPerMeter * tileLengthMeters) / sourceWidth,
      c: 0,
      d: (tileHeightMeters * averageScale) / sourceHeight,
      e: nearX + xPerMeter * startOffset,
      f: nearTop + yPerMeter * startOffset,
    });
  }

  function transformObjectPattern(
    pattern: CanvasPattern,
    x: number,
    y: number,
    scale: number,
    tileWidthMeters: number,
    tileHeightMeters: number,
    sourceWidth = 512,
    sourceHeight = 512,
  ): void {
    pattern.setTransform({
      a: (tileWidthMeters * scale) / sourceWidth,
      b: 0,
      c: 0,
      d: (tileHeightMeters * scale) / sourceHeight,
      e: x,
      f: y,
    });
  }

  function configureContextTransforms(): void {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    glowLayer.context.setTransform(
      pixelRatio * glowRatio,
      0,
      0,
      pixelRatio * glowRatio,
      0,
      0,
    );
    glowLayer.context.imageSmoothingEnabled = true;
    glowLayer.context.imageSmoothingQuality = "high";
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
  }

  function rebuildStaticGradients(): void {
    skyGradientCache = context.createLinearGradient(0, 0, 0, cssHeight);
    skyGradientCache.addColorStop(0, "#010509");
    skyGradientCache.addColorStop(0.42, "#03090e");
    skyGradientCache.addColorStop(0.7, "#0a1116");
    skyGradientCache.addColorStop(1, "#11171b");

    horizonHazeCache = context.createRadialGradient(
      cssWidth * 0.52,
      horizon,
      0,
      cssWidth * 0.52,
      horizon,
      cssWidth * 0.7,
    );
    horizonHazeCache.addColorStop(0, "rgba(31, 48, 57, 0.22)");
    horizonHazeCache.addColorStop(0.45, "rgba(15, 27, 34, 0.09)");
    horizonHazeCache.addColorStop(1, "rgba(0, 0, 0, 0)");

    leftHeadlightWashCache = context.createRadialGradient(
      cssWidth * 0.12,
      cssHeight * 0.82,
      0,
      cssWidth * 0.12,
      cssHeight * 0.82,
      cssHeight * 0.48,
    );
    leftHeadlightWashCache.addColorStop(0, "rgba(128, 201, 230, 0.2)");
    leftHeadlightWashCache.addColorStop(0.38, "rgba(88, 151, 181, 0.07)");
    leftHeadlightWashCache.addColorStop(1, "rgba(0, 0, 0, 0)");

    rightHeadlightWashCache = context.createRadialGradient(
      cssWidth * 0.88,
      cssHeight * 0.86,
      0,
      cssWidth * 0.88,
      cssHeight * 0.86,
      cssHeight * 0.45,
    );
    rightHeadlightWashCache.addColorStop(0, "rgba(103, 172, 203, 0.12)");
    rightHeadlightWashCache.addColorStop(1, "rgba(0, 0, 0, 0)");

    roadSheenCache = context.createRadialGradient(
      cssWidth * 0.5,
      cssHeight * 1.04,
      cssHeight * 0.04,
      cssWidth * 0.5,
      cssHeight * 1.04,
      Math.max(cssWidth, cssHeight) * 0.7,
    );
    roadSheenCache.addColorStop(0, "rgba(139, 194, 211, 0.092)");
    roadSheenCache.addColorStop(0.46, "rgba(87, 138, 158, 0.032)");
    roadSheenCache.addColorStop(1, "rgba(0, 0, 0, 0)");

    distanceFogCache = context.createLinearGradient(
      0,
      horizon - cssHeight * 0.09,
      0,
      horizon + cssHeight * 0.21,
    );
    distanceFogCache.addColorStop(0, "rgba(18, 29, 35, 0)");
    distanceFogCache.addColorStop(0.48, "rgba(23, 36, 42, 0.105)");
    distanceFogCache.addColorStop(1, "rgba(15, 22, 27, 0)");

    vignetteCache = context.createRadialGradient(
      cssWidth * 0.5,
      cssHeight * 0.5,
      Math.min(cssWidth, cssHeight) * 0.22,
      cssWidth * 0.5,
      cssHeight * 0.49,
      Math.max(cssWidth, cssHeight) * 0.72,
    );
    vignetteCache.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignetteCache.addColorStop(0.66, "rgba(0, 0, 0, 0.08)");
    vignetteCache.addColorStop(1, "rgba(0, 0, 0, 0.58)");
  }

  function regenerateNoise(seedOffset: number): void {
    const noiseContext = noiseLayer.context;
    const width = noiseLayer.canvas.width;
    const height = noiseLayer.canvas.height;
    if (
      !noiseImageData ||
      noiseImageData.width !== width ||
      noiseImageData.height !== height
    ) {
      noiseImageData = noiseContext.createImageData(width, height);
    }
    const image = noiseImageData;
    for (let index = 0; index < image.data.length; index += 4) {
      const grain = hashInteger(index + seedOffset * 1973);
      const light = 104 + (grain & 63);
      image.data[index] = light;
      image.data[index + 1] = light + 2;
      image.data[index + 2] = light + 4;
      image.data[index + 3] = 10 + ((grain >>> 9) & 15);
    }
    noiseContext.putImageData(image, 0, 0);
  }

  function resize(): void {
    if (destroyed) return;
    const bounds = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(bounds.width || window.innerWidth));
    const nextHeight = Math.max(1, Math.round(bounds.height || window.innerHeight));
    const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const mobile = coarsePointer || nextWidth < 760;

    quality = mobile ? "MOBILE" : nextWidth < 1280 ? "BALANCED" : "HIGH";
    const ratioCap = quality === "HIGH" ? 1.65 : quality === "BALANCED" ? 1.45 : 1.18;
    const pixelBudget = quality === "HIGH" ? 5_200_000 : quality === "BALANCED" ? 3_600_000 : 2_100_000;
    const budgetRatio = Math.sqrt(pixelBudget / (nextWidth * nextHeight));
    const nextRatio = Math.max(
      0.75,
      Math.min(window.devicePixelRatio || 1, ratioCap, budgetRatio),
    );

    cssWidth = nextWidth;
    cssHeight = nextHeight;
    pixelRatio = nextRatio;
    glowRatio = quality === "MOBILE" ? 0.42 : 0.5;
    focalLength = cssHeight * (cssWidth < cssHeight ? 0.72 : 0.8);
    horizon = cssHeight * (cssWidth < cssHeight ? 0.46 : 0.62);
    lightTrailPositions.clear();

    const backingWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
    const backingHeight = Math.max(1, Math.round(cssHeight * pixelRatio));
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }

    resizeDrawingLayer(
      glowLayer,
      backingWidth * glowRatio,
      backingHeight * glowRatio,
    );
    configureContextTransforms();
    rebuildStaticGradients();
    regenerateNoise(frameNumber);
    noisePattern = context.createPattern(noiseLayer.canvas, "repeat");
    renderFrame();
  }

  function projectedAt(
    z: number,
    lateral = 0,
    objectHeight = 0,
  ): ProjectedPoint {
    const safeZ = Math.max(0.12, z);
    const world = totalDistanceMeters + safeZ;
    const cameraCenter = pathCenter(totalDistanceMeters);
    const cameraTangent = pathTangent(totalDistanceMeters);
    const cameraElevation = pathElevation(totalDistanceMeters);
    const elevationTangent = pathElevationTangent(totalDistanceMeters);
    const centerOffset =
      pathCenter(world) - cameraCenter - cameraTangent * safeZ;
    const elevationOffset =
      pathElevation(world) - cameraElevation - elevationTangent * safeZ;
    const scale = focalLength / safeZ;
    const cameraSway = Math.sin(elapsedTime * 0.72) * 0.026;
    const bob = Math.sin(elapsedTime * 5.1) * 0.34;
    const center =
      cssWidth * 0.5 +
      centerOffset * scale -
      cameraSway * scale +
      Math.sin(elapsedTime * 0.23) * 0.7;
    const groundY =
      horizon +
      bob +
      (CAMERA_HEIGHT - elevationOffset) * scale;

    return {
      x: center + lateral * scale,
      y: groundY - objectHeight * scale,
      groundY,
      scale,
    };
  }

  function buildRoadPoints(): void {
    roadPoints.length = 0;
    const profile = quality === "MOBILE"
      ? [
          [80, 1.3],
          [240, 2.8],
          [600, 6],
          [1100, 13],
          [FAR_DISTANCE, 25],
        ] as const
      : quality === "BALANCED"
        ? [
            [80, 0.85],
            [240, 1.8],
            [600, 4],
            [1100, 9],
            [FAR_DISTANCE, 18],
          ] as const
        : [
            [80, 0.6],
            [240, 1.4],
            [600, 3.2],
            [1100, 7],
            [FAR_DISTANCE, 14],
          ] as const;

    const appendPoint = (z: number): void => {
      const projected = projectedAt(z);
      roadPoints.push({
        z,
        world: totalDistanceMeters + z,
        center: projected.x,
        y: projected.groundY,
        scale: projected.scale,
      });
    };

    // Samples are locked to absolute road metres. Camera-relative samples
    // slide under the scene every frame and make walls/decks visibly crawl.
    appendPoint(NEAR_DISTANCE);
    let bandStart = NEAR_DISTANCE;
    for (const [bandEnd, spacing] of profile) {
      const worldStart = totalDistanceMeters + bandStart;
      const worldEnd = totalDistanceMeters + bandEnd;
      let world = Math.ceil(worldStart / spacing) * spacing;
      while (world < worldEnd - 0.0001) {
        const z = world - totalDistanceMeters;
        if (z > NEAR_DISTANCE + 0.0001) appendPoint(z);
        world += spacing;
      }
      bandStart = bandEnd;
    }
    appendPoint(FAR_DISTANCE);
  }

  function clearGlow(): void {
    const glowContext = glowLayer.context;
    glowContext.save();
    glowContext.setTransform(1, 0, 0, 1, 0, 0);
    glowContext.clearRect(0, 0, glowLayer.canvas.width, glowLayer.canvas.height);
    glowContext.restore();
  }

  function occludeGlowPolygon(points: ReadonlyArray<readonly [number, number]>): void {
    if (points.length < 3) return;
    const glowContext = glowLayer.context;
    glowContext.save();
    glowContext.globalCompositeOperation = "destination-out";
    glowContext.globalAlpha = 1;
    glowContext.fillStyle = "#000";
    fillPolygon(glowContext, points);
    glowContext.restore();
  }

  function occludeGlowRect(
    x: number,
    y: number,
    width: number,
    height: number,
    alpha = 1,
  ): void {
    if (width <= 0 || height <= 0) return;
    const glowContext = glowLayer.context;
    glowContext.save();
    glowContext.globalCompositeOperation = "destination-out";
    glowContext.globalAlpha = clamp(alpha, 0, 1);
    glowContext.fillStyle = "#000";
    glowContext.fillRect(x, y, width, height);
    glowContext.restore();
  }

  function drawGlowDot(
    x: number,
    y: number,
    radius: number,
    innerColor: string,
    outerColor = "rgba(0,0,0,0)",
  ): void {
    if (x < -radius || x > cssWidth + radius || y < -radius || y > cssHeight + radius) {
      return;
    }
    const glowContext = glowLayer.context;
    const gradient = glowContext.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, innerColor);
    gradient.addColorStop(0.24, innerColor);
    gradient.addColorStop(1, outerColor);
    glowContext.fillStyle = gradient;
    glowContext.beginPath();
    glowContext.arc(x, y, radius, 0, TAU);
    glowContext.fill();
  }

  function drawSky(): void {
    if (!skyGradientCache || !horizonHazeCache) rebuildStaticGradients();
    context.fillStyle = skyGradientCache ?? "#02070b";
    context.fillRect(0, 0, cssWidth, cssHeight);

    context.fillStyle = horizonHazeCache ?? "rgba(0, 0, 0, 0)";
    context.fillRect(0, horizon - cssHeight * 0.22, cssWidth, cssHeight * 0.52);
  }

  function buildingFootprint(
    index: number,
    side: -1 | 1,
    world: number,
  ): BuildingFootprint {
    const location = locationIndex(world);
    const occupancy = seeded(index * 2 + (side > 0 ? 1 : 0), 101);
    const openWaterfront = location === 8 || location === 9 || location === 10;
    const closeCanyon = location === 0 || location === 5 || location === 6 || location === 7;
    const widthMeters =
      (openWaterfront ? 18 : closeCanyon ? 30 : 24) +
      seeded(index, 139 + side) * (closeCanyon ? 44 : openWaterfront ? 44 : 48);
    const nominalCenterDistance =
      ROAD_HALF_WIDTH +
      (closeCanyon ? 16 : openWaterfront ? 30 : 18) +
      seeded(index, side > 0 ? 113 : 127) *
        (closeCanyon ? 58 : openWaterfront ? 96 : 72);
    const facadeClearance = closeCanyon ? 13 : openWaterfront ? 20 : 15;
    const minimumCenterDistance =
      ROAD_HALF_WIDTH + facadeClearance + widthMeters * 0.5;
    return {
      location,
      occupancy,
      openWaterfront,
      closeCanyon,
      widthMeters,
      lateral: side * Math.max(nominalCenterDistance, minimumCenterDistance),
    };
  }

  function clearsElevatedCorridor(
    world: number,
    footprint: BuildingFootprint,
  ): boolean {
    const firstBlock = Math.floor(world / SCENE_LENGTH) - 1;
    for (let block = firstBlock; block <= firstBlock + 2; block += 1) {
      const localWorld = world - block * SCENE_LENGTH;
      const transverseClearance = Math.max(20, footprint.widthMeters * 0.32);
      if (
        OVERPASS_ANCHORS.some(
          (anchor) => Math.abs(localWorld - anchor) < transverseClearance,
        )
      ) {
        return false;
      }
      for (const spec of ELEVATED_SPAN_SPECS) {
        // Include the full facade width and a maintenance/inspection margin.
        // This makes the secondary highway and the city share one physical
        // right-of-way instead of being two independent overlapping layers.
        const longitudinalMargin = Math.max(18, footprint.widthMeters * 0.28);
        if (
          localWorld < spec.drawStart - longitudinalMargin ||
          localWorld > spec.drawEnd + longitudinalMargin
        ) continue;
        const state = elevatedState(
          spec,
          clamp(localWorld, spec.drawStart, spec.drawEnd),
        );
        if (state.approach < 0.055) continue;
        const clearHalfWidth =
          spec.halfWidthMeters + footprint.widthMeters * 0.5 + 8.5;
        if (Math.abs(footprint.lateral - state.offset) < clearHalfWidth) {
          return false;
        }
      }
    }
    return true;
  }

  function drawBuilding(index: number, side: -1 | 1, z: number): void {
    if (z < NEAR_DISTANCE || z > CITY_FAR_DISTANCE) return;
    const footprint = buildingFootprint(index, side, totalDistanceMeters + z);
    const {
      location,
      occupancy,
      openWaterfront,
      closeCanyon,
      widthMeters,
      lateral,
    } = footprint;
    const locationDensity = [0.02, 0.08, 0.16, 0.19, 0.13, 0.02, 0.01, 0.04, 0.2, 0.24, 0.31, 0.12, 0.17, 0.06][location];
    const densityRelief = quality === "MOBILE" ? 0.08 : quality === "BALANCED" ? 0.045 : 0.025;
    if (occupancy < locationDensity + densityRelief) return;
    const base = projectedAt(z, lateral);
    const deckAboveTerrain =
      (openWaterfront ? 7.2 : closeCanyon ? 8.8 : 7.8) +
      seeded(index, 147 + side) * 3.4;
    base.groundY += deckAboveTerrain * base.scale;
    let heightMeters =
      (openWaterfront ? 14 : closeCanyon ? 42 : 28) +
      seeded(index, 151 - side) * (closeCanyon ? 138 : openWaterfront ? 52 : 104);
    if (seeded(index, 163) > (closeCanyon ? 0.72 : 0.88)) heightMeters += 68;

    const width = widthMeters * base.scale;
    const height = heightMeters * base.scale;
    if (width < 1 || height < 2 || base.x + width < -20 || base.x - width > cssWidth + 20) {
      return;
    }

    const left = base.x - width * 0.5;
    const top = base.groundY - height;
    const bodyLightness = Math.round(5 + seeded(index, 181) * 8);
    const skylineBlend = smoothstep(1850, CITY_FAR_DISTANCE, z);
    const skylineColor = (red: number, green: number, blue: number): string => {
      const skylineRed = Math.round(lerp(red, 5, skylineBlend));
      const skylineGreen = Math.round(lerp(green, 11, skylineBlend));
      const skylineBlue = Math.round(lerp(blue, 16, skylineBlend));
      return `rgb(${skylineRed}, ${skylineGreen}, ${skylineBlue})`;
    };
    // Keep the complete building mass opaque. Atmospheric depth is expressed
    // through colour lift instead of making distant towers look translucent.
    const atmosphericAlpha = 1;
    const depth = width * (0.12 + seeded(index, 193) * 0.12);
    const sideFace: ReadonlyArray<readonly [number, number]> = [
      [side > 0 ? left + width : left, top],
      [side > 0 ? left + width + depth : left - depth, top + depth * 0.22],
      [side > 0 ? left + width + depth : left - depth, base.groundY],
      [side > 0 ? left + width : left, base.groundY],
    ];

    // The glow buffer is composited after the entire scene. Punch the complete
    // opaque building silhouette out of it before adding this building's own
    // lights, otherwise distant landmarks appear to shine through the facade.
    occludeGlowRect(left, top, width, height + 2);
    occludeGlowPolygon(sideFace);

    context.globalAlpha = atmosphericAlpha;
    const facadeGradient = context.createLinearGradient(left, 0, left + width, 0);
    facadeGradient.addColorStop(
      0,
      skylineColor(Math.max(2, bodyLightness - 5), bodyLightness, bodyLightness + 3),
    );
    facadeGradient.addColorStop(
      0.48,
      skylineColor(bodyLightness + 2, bodyLightness + 7, bodyLightness + 11),
    );
    facadeGradient.addColorStop(
      1,
      skylineColor(Math.max(2, bodyLightness - 4), bodyLightness, bodyLightness + 5),
    );
    context.fillStyle = facadeGradient;
    context.fillRect(left, top, width, height + 2);
    const facadeTextureVisibility = 0.21 * farFade(z, 700, 1060);
    if (concretePattern && facadeTextureVisibility > 0.001) {
      context.save();
      context.globalAlpha = atmosphericAlpha * facadeTextureVisibility;
      transformObjectPattern(
        concretePattern,
        left,
        top,
        base.scale,
        4,
        4,
      );
      context.fillStyle = concretePattern;
      context.fillRect(left, top, width, height + 2);
      context.restore();
    }

    context.fillStyle = side > 0
      ? skylineColor(5, 9, 13)
      : skylineColor(13, 18, 22);
    fillPolygon(context, sideFace);

    const roofAccent = seeded(index, 211);
    if (roofAccent > 0.58 && width > 7) {
      const roofVisibility = farFade(z, 1300, 2200);
      context.globalAlpha = atmosphericAlpha * roofVisibility;
      context.strokeStyle = roofAccent > 0.83
        ? "rgba(159, 188, 199, 0.5)"
        : "rgba(88, 105, 115, 0.38)";
      context.lineWidth = clamp(base.scale * 0.18, 0.5, 2.2);
      context.beginPath();
      context.moveTo(left, top + 1);
      context.lineTo(left + width, top + 1);
      context.stroke();
      context.globalAlpha = atmosphericAlpha;
    }

    if (height > 3 && width > 2) {
      const realRows = Math.max(3, Math.floor(heightMeters / 3.35));
      const realColumns = Math.max(2, Math.floor(widthMeters / 3.1));
      const maximumRows = quality === "MOBILE" ? 12 : 30;
      const rowStep = Math.max(1, Math.ceil(realRows / maximumRows));
      const maximumColumns = quality === "MOBILE" ? 5 : 9;
      const columnStep = Math.max(1, Math.ceil(realColumns / maximumColumns));
      const windowWidth = clamp(base.scale * 2.05, 0.65, width * 0.18);
      const windowHeight = clamp(base.scale * 1.08, 0.55, 4.2);
      const windowVisibility =
        farFade(z, 1420, 2140) *
        lerp(0.56, 1.08, directorState.intensity);
      context.globalAlpha = atmosphericAlpha * windowVisibility;

      const facadeDetailVisibility =
        0.34 * farFade(z, 470, 820) * smoothstep(6, 18, width);
      if (facadeDetailVisibility > 0.002) {
        context.save();
        context.globalAlpha *= facadeDetailVisibility;
        context.strokeStyle = "rgba(4, 9, 12, 0.9)";
        context.lineWidth = clamp(base.scale * 0.045, 0.35, 1.2);
        const ribStep = Math.max(1, Math.ceil(realRows / 22));
        for (let row = ribStep; row < realRows; row += ribStep) {
          const ribY = base.groundY - row * 3.35 * base.scale;
          if (ribY <= top + 1) continue;
          context.beginPath();
          context.moveTo(left, ribY);
          context.lineTo(left + width, ribY);
          context.stroke();
        }
        const mullionStep = Math.max(1, Math.ceil(realColumns / 12));
        for (let column = mullionStep; column < realColumns; column += mullionStep) {
          const mullionX = left + column * 3.1 * base.scale;
          if (mullionX >= left + width) continue;
          context.beginPath();
          context.moveTo(mullionX, top);
          context.lineTo(mullionX, base.groundY);
          context.stroke();
        }
        context.restore();
      }

      for (let row = 1; row < realRows; row += rowStep) {
        const windowY = base.groundY - (row + 0.78) * 3.35 * base.scale;
        if (windowY < top + 2) continue;
        for (let column = 0; column < realColumns; column += columnStep) {
          const windowHash = seeded(index * 101 + row * 13 + column, side * 17 + 229);
          const windowX = left + (column + 0.86) * 3.1 * base.scale;
          if (windowX > left + width - 1) continue;
          const lit = windowHash >= (closeCanyon ? 0.56 : 0.68);
          const warm = windowHash > 0.946;
          context.fillStyle = lit
            ? warm
              ? "rgba(221, 190, 126, 0.78)"
              : windowHash > 0.83
                ? "rgba(164, 202, 216, 0.78)"
                : "rgba(104, 151, 170, 0.58)"
            : "rgba(3, 12, 17, 0.78)";
          context.fillRect(windowX, windowY, windowWidth, windowHeight);
          if (windowHash > 0.978) {
            drawGlowDot(
              windowX + windowWidth * 0.5,
              windowY + windowHeight * 0.5,
              clamp(base.scale * 1.8, 2, 12),
              warm
                ? `rgba(255, 188, 105, ${0.19 * windowVisibility})`
                : `rgba(143, 211, 239, ${0.16 * windowVisibility})`,
            );
          }
        }
      }
      context.globalAlpha = atmosphericAlpha;
    }

    if (
      advertisingSigns.length > 0 &&
      seeded(index, 271) > (location === 5 || location === 13 ? 0.68 : 0.88)
    ) {
      const signIndex = positiveModulo(
        index * 5 + (side > 0 ? 7 : 0),
        advertisingSigns.length,
      );
      const sign = advertisingSigns[signIndex];
      const boardAspect = sign.heightMeters / sign.widthMeters;
      const boardWidth = Math.min(
        width * 0.86,
        (height * 0.7) / boardAspect,
      );
      const boardHeight = boardWidth * boardAspect;
      const boardX = left + (width - boardWidth) * 0.5;
      const boardY = clamp(
        top + height * 0.12,
        top + 1,
        base.groundY - boardHeight - Math.max(1, height * 0.06),
      );
      const advertisingVisibility =
        smoothstep(2, 14, boardWidth) *
        smoothstep(1.5, 11, boardHeight) *
        farFade(z, 1750, 2550) *
        lerp(0.48, 1.16, directorState.intensity);
      if (advertisingVisibility > 0.002) {
        context.save();
        context.globalAlpha = atmosphericAlpha * advertisingVisibility;
        context.beginPath();
        context.rect(left + 1, top + 1, Math.max(0, width - 2), Math.max(0, height - 2));
        context.clip();
        context.fillStyle = sign.backgroundColor;
        context.fillRect(boardX, boardY, boardWidth, boardHeight);
        const detailVisibility = smoothstep(
          4,
          13,
          Math.max(boardWidth, boardHeight) * pixelRatio,
        );
        context.globalAlpha =
          atmosphericAlpha * advertisingVisibility * detailVisibility;
        context.drawImage(
          selectSignMipmap(sign, boardWidth, boardHeight),
          boardX,
          boardY,
          boardWidth,
          boardHeight,
        );
        context.restore();
        const glowVisibility = smoothstep(
          2.5,
          10,
          Math.max(boardWidth, boardHeight) * pixelRatio,
        );
        if (glowVisibility > 0.002) {
          drawGlowDot(
            boardX + boardWidth * 0.5,
            boardY + boardHeight * 0.5,
            boardWidth * 0.55,
            signGlowColor(
              sign.family,
              0.1 * advertisingVisibility * glowVisibility,
            ),
          );
        }
      }
    }

    if (heightMeters > 65 && width > 3) {
      const beaconVisibility = farFade(z, 1550, 2300);
      const beaconX = left + width * (0.28 + seeded(index, 283) * 0.44);
      const beaconY = top - 1;
      if (beaconVisibility > 0.002) {
        context.fillStyle = `rgba(223, 37, 34, ${0.9 * beaconVisibility})`;
        context.fillRect(beaconX - 1, beaconY - 1, 2, 2);
        drawGlowDot(
          beaconX,
          beaconY,
          clamp(base.scale * 1.4, 3, 13),
          `rgba(255, 30, 24, ${0.34 * beaconVisibility})`,
        );
      }
    }
    context.globalAlpha = 1;
  }

  function createLandmarkOptions(): ProceduralLandmarkOptions {
    return {
      totalDistanceMeters,
      sceneLength: SCENE_LENGTH,
      cssWidth,
      cssHeight,
      quality,
      project: (z, lateral, objectHeight) =>
        projectedAt(z, lateral, objectHeight),
      glowDot: drawGlowDot,
    };
  }

  function collectCityLayerItems(): void {
    const landmarkOptions = createLandmarkOptions();
    const landmarks = collectProceduralLandmarks(landmarkOptions);
    cityLayerItems.length = 0;
    for (const landmark of landmarks) {
      cityLayerItems.push({
        kind: "landmark",
        z: landmark.z,
        landmark,
      });
    }
    // Site reservations are anchored in world space, so buildings never pop
    // back when a landmark instance leaves the camera frustum.
    const landmarkSites = collectProceduralLandmarkSites(
      SCENE_LENGTH,
      totalDistanceMeters - 900,
      totalDistanceMeters + CITY_FAR_DISTANCE + 900,
    );
    const reservesLandmarkSite = (world: number, side: -1 | 1): boolean =>
      landmarkSites.some((site) => {
        if (site.kind === "rainbow-bridge") {
          // The Shibaura–Daiba approach is an open-water corridor. Keep the
          // suspension bridge and both tapered road runouts clear of towers.
          return world > site.world - 610 && world < site.world + 1_160;
        }
        if (Math.sign(site.lateral) !== side) return false;
        const [nearClearance, farClearance] =
          site.kind === "skytree"
            ? [460, 230]
            : site.kind === "tokyo-tower"
              ? [360, 190]
              : site.kind === "big-sight"
                ? [520, 250]
                : [380, 220];
        return (
          world > site.world - nearClearance &&
          world < site.world + farClearance
        );
      });
    const spacing = quality === "MOBILE" ? 51 : quality === "BALANCED" ? 41 : 35;
    const first = Math.floor((totalDistanceMeters - spacing) / spacing);
    const last = Math.ceil((totalDistanceMeters + CITY_FAR_DISTANCE + 90) / spacing);
    for (let index = last; index >= first; index -= 1) {
      const world = index * spacing + (seeded(index, 307) - 0.5) * spacing * 0.58;
      const z = world - totalDistanceMeters;
      const leftFootprint = buildingFootprint(index, -1, world);
      if (
        !reservesLandmarkSite(world, -1) &&
        clearsElevatedCorridor(world, leftFootprint)
      ) {
        cityLayerItems.push({ kind: "building", z, index, side: -1 });
      }
      const rightZ = z + (seeded(index, 311) - 0.5) * 14;
      const rightWorld = totalDistanceMeters + rightZ;
      const rightFootprint = buildingFootprint(index, 1, rightWorld);
      if (
        !reservesLandmarkSite(rightWorld, 1) &&
        clearsElevatedCorridor(rightWorld, rightFootprint)
      ) {
        cityLayerItems.push({ kind: "building", z: rightZ, index, side: 1 });
      }
    }

    collectElevatedLayerItems(cityLayerItems);
    cityLayerItems.sort((firstItem, secondItem) => secondItem.z - firstItem.z);
  }

  function drawCityLayerItem(item: CityLayerItem): void {
    if (item.kind === "building") {
      drawBuilding(item.index, item.side, item.z);
    } else if (item.kind === "landmark") {
      drawProceduralLandmark(
        context,
        glowLayer.context,
        createLandmarkOptions(),
        item.landmark,
      );
    } else if (item.kind === "elevated") {
      drawElevatedDeckSlice(item);
    } else {
      drawElevatedPier(
        item.spec,
        item.block,
        item.world,
        item.terminal,
      );
    }
  }

  function roadPointAt(z: number): RoadPoint {
    const safeZ = clamp(z, NEAR_DISTANCE, FAR_DISTANCE);
    const projected = projectedAt(safeZ);
    return {
      z: safeZ,
      world: totalDistanceMeters + safeZ,
      center: projected.x,
      y: projected.groundY,
      scale: projected.scale,
    };
  }

  function drawClippedRoadMarking(
    sliceFar: RoadPoint,
    sliceNear: RoadPoint,
    segmentNearWorld: number,
    segmentFarWorld: number,
    lateralNear: number,
    lateralFar: number,
    widthNear: number,
    widthFar: number,
    color: string,
  ): void {
    const clippedNearWorld = Math.max(sliceNear.world, segmentNearWorld);
    const clippedFarWorld = Math.min(sliceFar.world, segmentFarWorld);
    if (clippedFarWorld <= clippedNearWorld + 0.0001) return;

    const segmentLength = Math.max(0.0001, segmentFarWorld - segmentNearWorld);
    const nearMix = (clippedNearWorld - segmentNearWorld) / segmentLength;
    const farMix = (clippedFarWorld - segmentNearWorld) / segmentLength;
    const clippedLateralNear = lerp(lateralNear, lateralFar, nearMix);
    const clippedLateralFar = lerp(lateralNear, lateralFar, farMix);
    const clippedWidthNear = lerp(widthNear, widthFar, nearMix);
    const clippedWidthFar = lerp(widthNear, widthFar, farMix);
    const near = roadPointAt(clippedNearWorld - totalDistanceMeters);
    const far = roadPointAt(clippedFarWorld - totalDistanceMeters);
    const nearHalf = clippedWidthNear * near.scale * 0.5;
    const farHalf = clippedWidthFar * far.scale * 0.5;
    const nearX = near.center + clippedLateralNear * near.scale;
    const farX = far.center + clippedLateralFar * far.scale;

    context.fillStyle = color;
    fillPolygon(context, [
      [farX - farHalf, far.y],
      [farX + farHalf, far.y],
      [nearX + nearHalf, near.y + 0.75],
      [nearX - nearHalf, near.y + 0.75],
    ]);
  }

  function drawRoadSurfaceSlice(
    far: RoadPoint,
    near: RoadPoint,
  ): void {
    const farOuter = (ROAD_HALF_WIDTH + 1.18) * far.scale;
    const nearOuter = (ROAD_HALF_WIDTH + 1.18) * near.scale;
    const outerRoadPolygon: ReadonlyArray<readonly [number, number]> = [
      [far.center - farOuter, far.y],
      [far.center + farOuter, far.y],
      [near.center + nearOuter, near.y + 0.78],
      [near.center - nearOuter, near.y + 0.78],
    ];
    occludeGlowPolygon(outerRoadPolygon);
    context.fillStyle = "#202629";
    fillPolygon(context, outerRoadPolygon);

    const farRoad = ROAD_HALF_WIDTH * far.scale;
    const nearRoad = ROAD_HALF_WIDTH * near.scale;
    context.fillStyle = "#181c1f";
    fillPolygon(context, [
      [far.center - farRoad, far.y],
      [far.center + farRoad, far.y],
      [near.center + nearRoad, near.y + 0.8],
      [near.center - nearRoad, near.y + 0.8],
    ]);

    const textureVisibility = farFade(far.z, 720, 1180) * 0.32;
    if (asphaltPattern && textureVisibility > 0.001) {
      context.save();
      context.globalAlpha = textureVisibility;
      transformGroundPattern(
        asphaltPattern,
        far,
        near,
        far.center,
        far.y,
        near.center,
        near.y,
        512,
        1024,
        ROAD_HALF_WIDTH * 2,
        ROAD_HALF_WIDTH * 4,
      );
      context.fillStyle = asphaltPattern;
      fillPolygon(context, [
        [far.center - farRoad, far.y],
        [far.center + farRoad, far.y],
        [near.center + nearRoad, near.y + 0.8],
        [near.center - nearRoad, near.y + 0.8],
      ]);
      context.restore();
    }

    // Subtle bridge-deck expansion joints add the repeating structural scale
    // visible on long elevated sections without turning into a moving texture.
    const expansionSpacing = 96;
    const expansionWorld = Math.floor(far.world / expansionSpacing) * expansionSpacing;
    const expansionVisibility = farFade(far.z, 620, 1_020);
    if (
      expansionWorld > near.world &&
      expansionWorld <= far.world &&
      expansionVisibility > 0.002
    ) {
      const joint = roadPointAt(expansionWorld - totalDistanceMeters);
      const jointHalf = ROAD_HALF_WIDTH * joint.scale;
      const jointGap = clamp(joint.scale * 0.055, 0.5, 2.4);
      context.save();
      context.globalAlpha = 0.52 * expansionVisibility;
      context.strokeStyle = "rgba(2, 5, 7, 0.94)";
      context.lineWidth = clamp(joint.scale * 0.07, 0.55, 2.8);
      for (const offset of [-jointGap, jointGap]) {
        context.beginPath();
        context.moveTo(joint.center - jointHalf * 0.98, joint.y + offset);
        context.lineTo(joint.center + jointHalf * 0.98, joint.y + offset);
        context.stroke();
      }
      context.restore();
    }

    const seamIndex = Math.floor(far.world / 19);
    const seamWorld = seamIndex * 19;
    const seamVisibility = farFade(far.z, 360, 680) * 0.17;
    if (
      seamWorld > near.world &&
      seamWorld <= far.world &&
      (hashInteger(seamIndex) & 7) === 0 &&
      seamVisibility > 0.001
    ) {
      const seam = roadPointAt(seamWorld - totalDistanceMeters);
      const seamRoad = ROAD_HALF_WIDTH * seam.scale;
      context.save();
      context.globalAlpha = seamVisibility;
      context.strokeStyle = "rgba(4, 7, 9, 0.9)";
      context.lineWidth = clamp(seam.scale * 0.035, 0.4, 2.2);
      context.beginPath();
      context.moveTo(seam.center - seamRoad * 0.94, seam.y);
      context.lineTo(seam.center + seamRoad * 0.94, seam.y);
      context.stroke();
      context.restore();
    }

  }

  function drawRoadMarkingsSlice(far: RoadPoint, near: RoadPoint): void {
    const world = (far.world + near.world) * 0.5;
    const location = locationIndex(world);
    drawClippedRoadMarking(
      far,
      near,
      near.world,
      far.world,
      -ROAD_HALF_WIDTH + 0.18,
      -ROAD_HALF_WIDTH + 0.18,
      0.1,
      0.1,
      "rgba(228, 231, 229, 0.91)",
    );
    drawClippedRoadMarking(
      far,
      near,
      near.world,
      far.world,
      ROAD_HALF_WIDTH - 0.18,
      ROAD_HALF_WIDTH - 0.18,
      0.1,
      0.1,
      "rgba(225, 228, 226, 0.88)",
    );

    const local = locationLocal(world);
    const restrictedLaneChange = location === 12 && local > 145 && local < 435;
    if (restrictedLaneChange) {
      drawClippedRoadMarking(
        far,
        near,
        near.world,
        far.world,
        0,
        0,
        0.15,
        0.15,
        "rgba(232, 184, 35, 0.92)",
      );
    } else {
      // MLIT urban expressway standard: 6 m line / 9 m gap, 0.15 m wide.
      const dashPeriod = 15;
      const firstDash = Math.floor(near.world / dashPeriod) * dashPeriod;
      for (let dashWorld = firstDash; dashWorld <= far.world; dashWorld += dashPeriod) {
        drawClippedRoadMarking(
          far,
          near,
          dashWorld,
          dashWorld + 6,
          0,
          0,
          0.15,
          0.15,
          "rgba(228, 231, 229, 0.92)",
        );
      }
    }

    // Hakozaki-style destination guides: the colored dotted lane borders
    // match the colored arrows used on the overhead direction signs.
    if (location === 1 && local > 175 && local < 565) {
      const locationBase = Math.floor(world / LOCATION_LENGTH) * LOCATION_LENGTH;
      const guideNear = Math.max(near.world, locationBase + 175);
      const guideFar = Math.min(far.world, locationBase + 565);
      const guidePeriod = 4.8;
      const firstGuide = Math.floor(guideNear / guidePeriod) * guidePeriod;
      for (
        let guideWorld = firstGuide;
        guideWorld <= guideFar;
        guideWorld += guidePeriod
      ) {
        const segmentNear = Math.max(guideNear, guideWorld);
        const segmentFar = Math.min(guideFar, guideWorld + 2.35);
        if (segmentFar <= segmentNear) continue;
        for (const lateral of [-3.18, -0.28]) {
          drawClippedRoadMarking(
            far,
            near,
            segmentNear,
            segmentFar,
            lateral,
            lateral,
            0.17,
            0.17,
            "rgba(226, 69, 68, 0.88)",
          );
        }
        for (const lateral of [0.28, 3.18]) {
          drawClippedRoadMarking(
            far,
            near,
            segmentNear,
            segmentFar,
            lateral,
            lateral,
            0.17,
            0.17,
            "rgba(45, 150, 231, 0.9)",
          );
        }
      }
    }

    const firstBlock = Math.floor((near.world - 6120) / SCENE_LENGTH) - 1;
    const lastBlock = Math.ceil((far.world - 6120) / SCENE_LENGTH) + 1;
    for (let block = firstBlock; block <= lastBlock; block += 1) {
      const zebraStart = block * SCENE_LENGTH + 6120;
      const firstStripe = Math.max(
        0,
        Math.floor((near.world - zebraStart) / 5.1) - 1,
      );
      const lastStripe = Math.min(
        21,
        Math.ceil((far.world - zebraStart) / 5.1) + 1,
      );
      for (let stripe = firstStripe; stripe <= lastStripe; stripe += 1) {
        const stripeWorld = zebraStart + stripe * 5.1;
        drawClippedRoadMarking(
          far,
          near,
          stripeWorld,
          stripeWorld + 1.9,
          1.15,
          3.75,
          0.3,
          0.3,
          "rgba(225, 228, 226, 0.72)",
        );
      }
    }

    const arrowPeriod = 430;
    const firstArrow = Math.floor((near.world - 70 - 9.6) / arrowPeriod);
    const lastArrow = Math.ceil((far.world - 70) / arrowPeriod);
    for (let arrowIndex = firstArrow; arrowIndex <= lastArrow; arrowIndex += 1) {
      const arrowWorld = arrowIndex * arrowPeriod + 70;
      const lane = seeded(arrowIndex, 347) > 0.5 ? 1.95 : -1.95;
      drawClippedRoadMarking(
        far,
        near,
        arrowWorld,
        arrowWorld + 6.3,
        lane,
        lane,
        0.28,
        0.28,
        "rgba(228, 231, 229, 0.82)",
      );
      drawClippedRoadMarking(
        far,
        near,
        arrowWorld + 5.6,
        arrowWorld + 9.6,
        lane,
        lane,
        1.12,
        0.05,
        "rgba(228, 231, 229, 0.82)",
      );
    }
  }

  function elevatedState(spec: ElevatedSpanSpec, localWorld: number): {
    offset: number;
    height: number;
    approach: number;
  } {
    const entering = smoothstep(spec.drawStart, spec.coreStart, localWorld);
    const leaving = 1 - smoothstep(spec.coreEnd, spec.drawEnd, localWorld);
    const approach = Math.min(entering, leaving);
    const coreProgress = clamp(
      (localWorld - spec.coreStart) / Math.max(1, spec.coreEnd - spec.coreStart),
      0,
      1,
    );
    const coreOffset =
      spec.coreOffset +
      Math.sin((coreProgress + spec.curvePhase) * TAU) * (spec.level === 0 ? 4.8 : 6.2);
    const terminalDirection = localWorld < spec.coreStart
      ? -spec.terminalSide
      : spec.terminalSide;
    const terminalOffset = terminalDirection * (spec.level === 0 ? 330 : 380);
    return {
      offset: lerp(terminalOffset, coreOffset, approach),
      height: lerp(1.55, spec.heightMeters, approach),
      approach,
    };
  }

  function drawElevatedPier(
    spec: ElevatedSpanSpec,
    block: number,
    world: number,
    terminal = false,
  ): void {
    const localWorld = world - block * SCENE_LENGTH;
    const state = elevatedState(spec, localWorld);
    if (state.approach <= 0.001) return;
    const z = world - totalDistanceMeters;
    if (z < NEAR_DISTANCE || z > FAR_DISTANCE) return;
    const base = projectedAt(z, state.offset);
    const capHeight = terminal ? 1.25 : 0.8;
    const top = projectedAt(z, state.offset, Math.max(0.6, state.height - capHeight));
    const columnWidth = (terminal ? 3.8 : 2.15) * base.scale;
    const capWidth = (spec.halfWidthMeters * 2 + (terminal ? 5.4 : 2.4)) * base.scale;
    const terrainDropMeters =
      (terminal ? 10.8 : 8.2) + seeded(Math.round(world / 6), 1_763) * 2.6;
    const pierGroundY = base.groundY + terrainDropMeters * base.scale;
    const footingHeight = (terminal ? 0.72 : 0.48) * base.scale;
    const footingWidth = columnWidth * (terminal ? 1.72 : 1.58);
    const projectedExtent = Math.max(columnWidth, capWidth, footingWidth);
    if (
      base.x + projectedExtent < -30 ||
      base.x - projectedExtent > cssWidth + 30
    ) return;

    // Piers used to enter as fully opaque geometry as soon as either the far
    // clip plane or the viewport edge admitted a single pixel. Blend those
    // boundaries independently so the supports are already present in the
    // haze before they become readable architectural elements.
    const distanceVisibility = farFade(
      z,
      FAR_DISTANCE * 0.72,
      FAR_DISTANCE,
    );
    const approachVisibility = smoothstep(0.018, 0.16, state.approach);
    const screenOverlap = Math.min(
      base.x + projectedExtent + 30,
      cssWidth + 30 - (base.x - projectedExtent),
    );
    const edgeVisibility = smoothstep(
      0,
      clamp(cssWidth * 0.075, 34, 92),
      screenOverlap,
    );
    const projectedVisibility = smoothstep(
      0.24,
      0.92,
      Math.max(columnWidth, footingHeight),
    );
    const visibility =
      distanceVisibility *
      approachVisibility *
      edgeVisibility *
      projectedVisibility;
    if (visibility <= 0.001) return;
    occludeGlowRect(
      base.x - columnWidth * 0.5,
      top.y,
      columnWidth,
      Math.max(0, pierGroundY - top.y),
      visibility,
    );
    occludeGlowRect(
      base.x - capWidth * 0.5,
      top.y - capHeight * base.scale,
      capWidth,
      capHeight * base.scale,
      visibility,
    );
    occludeGlowRect(
      base.x - footingWidth * 0.5,
      pierGroundY - footingHeight,
      footingWidth,
      footingHeight,
      visibility,
    );
    context.save();
    context.globalAlpha = visibility;
    context.fillStyle = terminal ? "#4a5559" : "#3d474b";
    context.fillRect(
      base.x - columnWidth * 0.5,
      top.y,
      columnWidth,
      Math.max(0, pierGroundY - top.y),
    );
    context.fillStyle = terminal ? "#59656a" : "#4b575c";
    context.fillRect(
      base.x - capWidth * 0.5,
      top.y - capHeight * base.scale,
      capWidth,
      capHeight * base.scale,
    );
    context.fillStyle = terminal ? "#3a4448" : "#333d41";
    context.fillRect(
      base.x - footingWidth * 0.5,
      pierGroundY - footingHeight,
      footingWidth,
      footingHeight,
    );
    context.strokeStyle = "rgba(142, 157, 161, 0.36)";
    context.lineWidth = clamp(base.scale * 0.06, 0.4, 1.8);
    context.strokeRect(
      base.x - columnWidth * 0.5,
      top.y,
      columnWidth,
      Math.max(0, pierGroundY - top.y),
    );
    context.restore();
  }

  function collectElevatedLayerItems(target: CityLayerItem[]): void {
    const activeSpans: Array<{
      spec: ElevatedSpanSpec;
      block: number;
      start: number;
      end: number;
    }> = [];
    const firstBlock = Math.floor((totalDistanceMeters - SCENE_LENGTH) / SCENE_LENGTH);
    const lastBlock = Math.ceil((totalDistanceMeters + FAR_DISTANCE) / SCENE_LENGTH);
    for (let block = firstBlock; block <= lastBlock; block += 1) {
      for (const spec of ELEVATED_SPAN_SPECS) {
        if (quality === "MOBILE" && spec.level === 1) continue;
        const start = block * SCENE_LENGTH + spec.drawStart;
        const end = block * SCENE_LENGTH + spec.drawEnd;
        if (end < totalDistanceMeters + NEAR_DISTANCE || start > totalDistanceMeters + FAR_DISTANCE) continue;
        activeSpans.push({ spec, block, start, end });
      }
    }
    for (const span of activeSpans) {
      const { spec, block, start, end } = span;
      for (let index = roadPoints.length - 1; index >= 1; index -= 1) {
        const sliceFar = roadPoints[index];
        const sliceNear = roadPoints[index - 1];
        const clippedNearWorld = Math.max(sliceNear.world, start);
        const clippedFarWorld = Math.min(sliceFar.world, end);
        if (clippedFarWorld <= clippedNearWorld + 0.0001) continue;
        target.push({
          kind: "elevated",
          z: (clippedNearWorld + clippedFarWorld) * 0.5 - totalDistanceMeters,
          spec,
          block,
          nearWorld: clippedNearWorld,
          farWorld: clippedFarWorld,
        });
      }

      // Piers have their own world-space depth items. Keeping them out of the
      // adaptive deck slices prevents a support from changing draw order when
      // the road tessellation changes between far, middle and near distance.
      const supportSpacing = 42;
      const firstSupport = Math.ceil(start / supportSpacing) * supportSpacing;
      const terminalWorlds = [
        block * SCENE_LENGTH + spec.coreStart,
        block * SCENE_LENGTH + spec.coreEnd,
      ];
      for (
        let supportWorld = firstSupport;
        supportWorld <= end;
        supportWorld += supportSpacing
      ) {
        if (
          terminalWorlds.some(
            (terminalWorld) => Math.abs(terminalWorld - supportWorld) < 15,
          )
        ) continue;
        const z = supportWorld - totalDistanceMeters;
        if (z < NEAR_DISTANCE || z > FAR_DISTANCE) continue;
        target.push({
          kind: "elevated-pier",
          z,
          spec,
          block,
          world: supportWorld,
          terminal: false,
        });
      }
      for (const terminalWorld of terminalWorlds) {
        const z = terminalWorld - totalDistanceMeters;
        if (z < NEAR_DISTANCE || z > FAR_DISTANCE) continue;
        target.push({
          kind: "elevated-pier",
          z,
          spec,
          block,
          world: terminalWorld,
          terminal: true,
        });
      }
    }
  }

  function drawElevatedDeckSlice(
    item: Extract<CityLayerItem, { kind: "elevated" }>,
  ): void {
    const { spec, block, nearWorld, farWorld } = item;
    const far = roadPointAt(farWorld - totalDistanceMeters);
    const near = roadPointAt(nearWorld - totalDistanceMeters);
    const farState = elevatedState(spec, far.world - block * SCENE_LENGTH);
    const nearState = elevatedState(spec, near.world - block * SCENE_LENGTH);

    const farY = far.y - farState.height * far.scale;
    const nearY = near.y - nearState.height * near.scale;
    const farCenter = far.center + farState.offset * far.scale;
    const nearCenter = near.center + nearState.offset * near.scale;
    const farHalf = spec.halfWidthMeters * far.scale;
    const nearHalf = spec.halfWidthMeters * near.scale;
    const thicknessFar = 1.08 * far.scale;
    const thicknessNear = 1.08 * near.scale;
    const deckTop: ReadonlyArray<readonly [number, number]> = [
      [farCenter - farHalf, farY],
      [farCenter + farHalf, farY],
      [nearCenter + nearHalf, nearY],
      [nearCenter - nearHalf, nearY],
    ];
    const deckBody: ReadonlyArray<readonly [number, number]> = [
      [farCenter - farHalf, farY],
      [farCenter + farHalf, farY],
      [farCenter + farHalf, farY + thicknessFar],
      [nearCenter + nearHalf, nearY + thicknessNear],
      [nearCenter - nearHalf, nearY + thicknessNear],
      [farCenter - farHalf, farY + thicknessFar],
    ];

    occludeGlowPolygon(deckBody);
    context.fillStyle = spec.level === 0 ? "#2c353a" : "#21292e";
    fillPolygon(context, deckTop);
    const deckTextureVisibility = 0.16 * farFade(near.z, 620, 980);
    if (metalPattern && deckTextureVisibility > 0.001) {
      context.save();
      context.globalAlpha = deckTextureVisibility;
      transformGroundPattern(
        metalPattern,
        far,
        near,
        farCenter,
        farY,
        nearCenter,
        nearY,
        512,
        512,
        spec.halfWidthMeters * 2,
        spec.halfWidthMeters * 2,
      );
      context.fillStyle = metalPattern;
      fillPolygon(context, deckTop);
      context.restore();
    }
    context.fillStyle = spec.level === 0 ? "#11181c" : "#0d1418";
    fillPolygon(context, deckBody);

    // Wall parapets and longitudinal girder lines make the upper carriageway
    // read as a supported bridge deck rather than a floating ribbon.
    const parapetHeightMeters = spec.level === 0 ? 0.82 : 0.72;
    for (const side of [-1, 1] as const) {
      const farEdgeX = farCenter + side * farHalf;
      const nearEdgeX = nearCenter + side * nearHalf;
      const parapet: ReadonlyArray<readonly [number, number]> = [
        [farEdgeX, farY],
        [farEdgeX, farY - parapetHeightMeters * far.scale],
        [nearEdgeX, nearY - parapetHeightMeters * near.scale],
        [nearEdgeX, nearY + thicknessNear * 0.12],
      ];
      occludeGlowPolygon(parapet);
      context.fillStyle = side < 0 ? "#465258" : "#39454b";
      fillPolygon(context, parapet);
      context.strokeStyle = "rgba(177, 191, 195, 0.42)";
      context.lineWidth = clamp(near.scale * 0.055, 0.38, 1.7);
      context.beginPath();
      context.moveTo(farEdgeX, farY - parapetHeightMeters * far.scale);
      context.lineTo(nearEdgeX, nearY - parapetHeightMeters * near.scale);
      context.stroke();
    }

    context.strokeStyle = "rgba(99, 116, 124, 0.34)";
    context.lineWidth = clamp(near.scale * 0.075, 0.45, 2.1);
    for (const girderRatio of [-0.55, 0.55]) {
      context.beginPath();
      context.moveTo(
        farCenter + farHalf * girderRatio,
        farY + thicknessFar * 0.88,
      );
      context.lineTo(
        nearCenter + nearHalf * girderRatio,
        nearY + thicknessNear * 0.88,
      );
      context.stroke();
    }
    context.strokeStyle = "rgba(137, 153, 159, 0.45)";
    context.lineWidth = clamp(near.scale * 0.1, 0.45, 2.4);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(farCenter + farHalf, farY);
    context.lineTo(nearCenter + nearHalf, nearY);
    context.moveTo(farCenter - farHalf, farY);
    context.lineTo(nearCenter - nearHalf, nearY);
    context.stroke();
  }

  type ScriptedRoadObstaclePose = Readonly<{
    z: number;
    lateral: number;
    kind: VehicleKind;
    role: "merging-truck" | "maintenance";
    shade: number;
    signalSide?: -1 | 1;
  }>;

  function scriptedRoadObstaclePose(
    event: NonNullable<DriveDirectorState["event"]>,
  ): ScriptedRoadObstaclePose | null {
    const { progressMeters: progress, durationMeters: duration } = event;
    const { side, variant } = event;
    if (event.kind === "taxi-overtake") return null;
    if (event.kind === "truck-merge") {
      return {
        z: lerp(
          FAR_DISTANCE - 35,
          0.05,
          smoothstep(0, duration, progress),
        ),
        lateral: lerp(
          side * OVERTAKE_LANE_OFFSET_METERS,
          -side * OVERTAKE_LANE_OFFSET_METERS,
          smoothstep(
            duration * [0.36, 0.48, 0.58][variant],
            duration * [0.62, 0.76, 0.86][variant],
            progress,
          ),
        ),
        kind: "truck",
        role: "merging-truck",
        shade: 0.58,
        signalSide: -side,
      };
    }
    return {
      z: lerp(
        FAR_DISTANCE - 55,
        0.05,
        smoothstep(0, duration, progress),
      ),
      lateral: side * [2.08, 2.28, 2.42][variant],
      kind: variant === 2 ? "truck" : "minivan",
      role: "maintenance",
      shade: 0.94,
    };
  }

  function collectDirectorEventObject(): void {
    const event = directorState.event;
    if (!event) {
      taxiEncounterActive = false;
      return;
    }
    const progress = event.progressMeters;
    const duration = event.durationMeters;
    const side = event.side;
    const variant = event.variant;
    let z = FAR_DISTANCE;
    let lanePosition = side * 1.72;

    eventVehicle.signalSide = undefined;
    if (event.kind === "taxi-overtake") {
      // The taxi now keeps moving away after it passes rather than returning
      // toward the camera in the second half of the encounter.
      const desiredZ = lerp(
        0.08,
        [560, 620, 680][variant],
        clamp(progress / duration, 0, 1),
      );
      eventVehicle.kind = "sedan";
      eventVehicle.role = "taxi";
      eventVehicle.shade = 0.08;
      if (!taxiEncounterActive) {
        taxiEncounterActive = true;
        taxiVisualZ = 0.05;
        taxiLongitudinalVelocity = 0;
        taxiLastUpdateTime = elapsedTime;
        taxiLanePosition = side * OVERTAKE_LANE_OFFSET_METERS;
        taxiTargetLanePosition = taxiLanePosition;
        taxiLaneVelocity = 0;
        taxiLastLaneDecisionProgress = Number.NEGATIVE_INFINITY;
      }

      const taxiDeltaSeconds = clamp(
        elapsedTime - taxiLastUpdateTime,
        0,
        0.05,
      );
      taxiLastUpdateTime = elapsedTime;

      for (let index = 0; index < vehicles.length; index += 1) {
        const vehicle = vehicles[index];
        const sample = taxiTrafficSamples[index];
        sample.z = vehicle.z;
        sample.lateral = safeVehicleLanePosition(
          vehicle,
          vehicle.lanePosition ??
            vehicle.lane * OVERTAKE_LANE_OFFSET_METERS,
        );
        sample.kind = vehicle.kind;
      }

      const laneSettled =
        Math.abs(taxiTargetLanePosition - taxiLanePosition) < 0.035 &&
        Math.abs(taxiLaneVelocity) < 0.04;
      const decisionSpacing = [150, 170, 190][variant];
      if (
        laneSettled &&
        progress - taxiLastLaneDecisionProgress >= decisionSpacing
      ) {
        const selectedLane = selectPassingLane(
          taxiVisualZ,
          taxiTargetLanePosition,
          taxiTrafficSamples,
        );
        if (selectedLane !== taxiTargetLanePosition) {
          taxiTargetLanePosition = selectedLane;
          taxiLastLaneDecisionProgress = progress;
        }
      }
      const lateralState = advancePassingLateral(
        taxiLanePosition,
        taxiLaneVelocity,
        taxiTargetLanePosition,
        taxiDeltaSeconds,
      );
      taxiLanePosition = lateralState.lateral;
      taxiLaneVelocity = lateralState.velocity;
      lanePosition = taxiLanePosition;
      if (
        Math.abs(taxiTargetLanePosition - taxiLanePosition) > 0.08 ||
        Math.abs(taxiLaneVelocity) > 0.08
      ) {
        eventVehicle.signalSide = taxiTargetLanePosition >= 0 ? 1 : -1;
      }

      // This remains as a last-resort guard for a temporarily boxed-in taxi.
      // The early lane selection above normally clears the vehicle before this
      // longitudinal limit can become visible.
      let safeTargetZ = desiredZ;
      for (let index = 0; index < taxiTrafficSamples.length; index += 1) {
        const sample = taxiTrafficSamples[index];
        safeTargetZ = safeOvertakeTargetAgainstVehicle(
          safeTargetZ,
          taxiVisualZ,
          lanePosition,
          sample.z,
          sample.lateral,
          sample.kind,
        );
      }
      const longitudinalState = advanceOvertakeMotion(
        taxiVisualZ,
        taxiLongitudinalVelocity,
        safeTargetZ,
        taxiDeltaSeconds,
      );
      taxiVisualZ = longitudinalState.z;
      taxiLongitudinalVelocity = longitudinalState.velocity;
      z = taxiVisualZ;
    } else {
      taxiEncounterActive = false;
      const obstacle = scriptedRoadObstaclePose(event);
      if (!obstacle) return;
      z = obstacle.z;
      lanePosition = obstacle.lateral;
      eventVehicle.kind = obstacle.kind;
      eventVehicle.role = obstacle.role;
      eventVehicle.shade = obstacle.shade;
      eventVehicle.signalSide = obstacle.signalSide;
    }

    lanePosition = safeVehicleLanePosition(eventVehicle, lanePosition);
    eventVehicle.z = z;
    eventVehicle.lane = lanePosition >= 0 ? 1 : -1;
    eventVehicle.lanePosition = lanePosition;
    if (z >= NEAR_DISTANCE && z < FAR_DISTANCE) {
      sceneObjects.push({ kind: "vehicle", z, vehicle: eventVehicle });
    }
  }

  function collectSceneObjects(): void {
    sceneObjects.length = 0;

    const lightFirst = Math.floor((totalDistanceMeters - LIGHT_SPACING) / LIGHT_SPACING);
    const lightLast = Math.ceil((totalDistanceMeters + FAR_DISTANCE) / LIGHT_SPACING);
    for (let index = lightFirst; index <= lightLast; index += 1) {
      const world = index * LIGHT_SPACING;
      const z = world - totalDistanceMeters;
      if (z < NEAR_DISTANCE || z > FAR_DISTANCE) continue;
      sceneObjects.push({
        kind: "light",
        z,
        index,
        side: index % 2 === 0 ? -1 : 1,
      });
    }

    const signFirst = Math.floor((totalDistanceMeters - 210) / SIGN_SPACING) - 1;
    const signLast = Math.ceil((totalDistanceMeters + FAR_DISTANCE - 210) / SIGN_SPACING) + 1;
    for (let index = signFirst; index <= signLast; index += 1) {
      const world = index * SIGN_SPACING + 210;
      const z = world - totalDistanceMeters;
      if (z >= NEAR_DISTANCE && z < FAR_DISTANCE) {
        const sign = roadSigns[positiveModulo(index, roadSigns.length)];
        const roadside =
          Boolean(sign?.family.startsWith("blue")) &&
          positiveModulo(index, 3) === 1;
        if (roadside) {
          const side: -1 | 1 = index % 2 === 0 ? -1 : 1;
          if (roadsideSignBlockedByTallWall(world, side)) continue;
        }
        sceneObjects.push({ kind: "sign", z, index });
      }
    }

    // Open-road emergency telephones are placed at roughly 500 m intervals.
    // A compact kilometre plate shares the cabinet so it remains readable
    // without overloading the scene with separate roadside props.
    const emergencySpacing = 500;
    const emergencyFirst = Math.floor(
      (totalDistanceMeters - emergencySpacing - 95) / emergencySpacing,
    );
    const emergencyLast = Math.ceil(
      (totalDistanceMeters + FAR_DISTANCE - 95) / emergencySpacing,
    );
    for (let index = emergencyFirst; index <= emergencyLast; index += 1) {
      const world = index * emergencySpacing + 95;
      const z = world - totalDistanceMeters;
      if (z < NEAR_DISTANCE || z >= FAR_DISTANCE) continue;
      const side: -1 | 1 = index % 2 === 0 ? -1 : 1;
      if (roadsideSignBlockedByTallWall(world, side)) continue;
      sceneObjects.push({
        kind: "emergency-unit",
        z,
        index,
        side,
      });
    }

    const firstBlock = Math.floor((totalDistanceMeters - SCENE_LENGTH) / SCENE_LENGTH);
    for (let block = firstBlock; block <= firstBlock + 2; block += 1) {
      // Keep transverse structures away from the open Rainbow Bridge sightline.
      for (let level = 0; level < OVERPASS_ANCHORS.length; level += 1) {
        const world = block * SCENE_LENGTH + OVERPASS_ANCHORS[level];
        const z = world - totalDistanceMeters;
        if (z >= NEAR_DISTANCE && z < OVERPASS_FAR_DISTANCE) {
          sceneObjects.push({
            kind: "overpass",
            z,
            index: block * OVERPASS_ANCHORS.length + level,
            level: level % 3,
          });
        }
      }
    }

    const activeVehicleCount = quality === "MOBILE" ? 12 : vehicles.length;
    for (let index = 0; index < activeVehicleCount; index += 1) {
      const vehicle = vehicles[index];
      if (vehicle.z >= NEAR_DISTANCE && vehicle.z < FAR_DISTANCE) {
        sceneObjects.push({ kind: "vehicle", z: vehicle.z, vehicle });
      }
    }
    collectDirectorEventObject();

    const bollardSpacing = 9.4;
    const bollardFirst = Math.floor((totalDistanceMeters - bollardSpacing) / bollardSpacing);
    const bollardLast = Math.ceil((totalDistanceMeters + FAR_DISTANCE) / bollardSpacing);
    for (let index = bollardFirst; index <= bollardLast; index += 1) {
      const world = index * bollardSpacing;
      if (locationIndex(world) !== 11) continue;
      const local = locationLocal(world);
      if (local < 65 || local > 645) continue;
      const z = world - totalDistanceMeters;
      if (z < NEAR_DISTANCE || z >= FAR_DISTANCE) continue;
      sceneObjects.push({
        kind: "bollard",
        z,
        index,
        side: local < 360 ? 1 : -1,
      });
    }

    sceneObjects.sort((first, second) => second.z - first.z);
  }

  function drawStreetLight(object: Extract<SceneObject, { kind: "light" }>): void {
    const world = totalDistanceMeters + object.z;
    const location = locationIndex(world);
    const cool = [1, 2, 6, 8, 9, 10, 12, 13].includes(location);
    const lateral = object.side * (ROAD_HALF_WIDTH + 1.7);
    const height = cool ? 8.8 : 8.2;
    const base = projectedAt(object.z, lateral);
    const top = projectedAt(object.z, lateral, height);
    const armLength = clamp(base.scale * 0.85, 1.5, 18);
    const lampX = top.x - object.side * armLength;

    const boundsPadding = clamp(base.scale * 0.2, 4, 42);
    const minimumX = Math.min(base.x, top.x, lampX) - boundsPadding;
    const maximumX = Math.max(base.x, top.x, lampX) + boundsPadding;
    const minimumY = Math.min(base.groundY, top.y) - boundsPadding;
    const maximumY = Math.max(base.groundY, top.y) + boundsPadding;
    if (
      maximumX < -20 ||
      minimumX > cssWidth + 20 ||
      maximumY < -20 ||
      minimumY > cssHeight + 20
    ) return;
    const visibility = farFade(object.z, FAR_DISTANCE * 0.7, FAR_DISTANCE);
    if (visibility <= 0.002) return;
    const lampEnergy = lerp(0.62, 1.12, directorState.intensity);
    context.save();
    context.globalAlpha = visibility;
    context.strokeStyle = cool
      ? "rgba(129, 151, 160, 0.68)"
      : "rgba(111, 102, 91, 0.7)";
    context.lineWidth = clamp(base.scale * 0.13, 0.45, 3.8);
    context.beginPath();
    context.moveTo(base.x, base.groundY);
    context.lineTo(top.x, top.y);
    context.lineTo(lampX, top.y + clamp(base.scale * 0.12, 0, 2));
    context.stroke();

    const lampRadius = clamp(base.scale * 0.24, 1.1, 5.5);
    context.fillStyle = cool ? "#d6f4ff" : "#ffd099";
    context.beginPath();
    context.ellipse(lampX, top.y + 0.5, lampRadius * 1.45, lampRadius, 0, 0, TAU);
    context.fill();

    const previous = lightTrailPositions.get(object.index);
    if (previous && frameNumber - previous.frame <= 2) {
      const deltaX = lampX - previous.x;
      const deltaY = top.y - previous.y;
      const distance = Math.hypot(deltaX, deltaY);
      if (distance > 0.08) {
        const trailLength = Math.min(7.5, distance);
        const ratio = trailLength / distance;
        const glowContext = glowLayer.context;
        glowContext.save();
        glowContext.globalAlpha = 0.14 * visibility * lampEnergy;
        glowContext.strokeStyle = cool
          ? "rgba(155, 224, 250, 0.72)"
          : "rgba(255, 156, 78, 0.7)";
        glowContext.lineWidth = Math.max(0.9, lampRadius * 1.16);
        glowContext.lineCap = "round";
        glowContext.beginPath();
        glowContext.moveTo(lampX - deltaX * ratio, top.y - deltaY * ratio);
        glowContext.lineTo(lampX, top.y);
        glowContext.stroke();
        glowContext.restore();
      }
    }
    lightTrailPositions.set(object.index, { x: lampX, y: top.y, frame: frameNumber });
    drawGlowDot(
      lampX,
      top.y,
      clamp(6 + base.scale * 2.7, 7, 58),
      cool
        ? `rgba(141, 215, 247, ${0.48 * visibility * lampEnergy})`
        : `rgba(255, 143, 65, ${0.5 * visibility * lampEnergy})`,
    );
    context.restore();
  }

  function drawOverpass(object: Extract<SceneObject, { kind: "overpass" }>): void {
    const base = projectedAt(object.z);
    const world = totalDistanceMeters + object.z;
    const location = locationIndex(world);
    const local = locationLocal(world);
    const detailVisibility = farFade(object.z, FAR_DISTANCE * 0.72, FAR_DISTANCE);
    // Begin the complete structure beyond the road mesh's far plane. It is
    // already opaque by the time it joins the normal depth scene, avoiding the
    // one-frame creation of minimum-width columns at 1,800 m.
    const visibility = farFade(
      object.z,
      FAR_DISTANCE + 100,
      OVERPASS_FAR_DISTANCE,
    );
    if (visibility <= 0.001) return;

    if (location === 12 && local > 375) {
      const portalHeight = 6.8 * base.scale;
      const portalHalf = 7.2 * base.scale;
      if (portalHeight > 1 && base.x + portalHalf > -30 && base.x - portalHalf < cssWidth + 30) {
        context.save();
        context.globalAlpha = visibility;
        context.strokeStyle = "#596266";
        context.lineWidth = clamp(base.scale * 1.05, 2, cssWidth * 0.11);
        context.lineJoin = "round";
        context.beginPath();
        context.moveTo(base.x - portalHalf, base.groundY + 2);
        context.lineTo(base.x - portalHalf, base.groundY - portalHeight * 0.64);
        context.quadraticCurveTo(
          base.x,
          base.groundY - portalHeight * 1.18,
          base.x + portalHalf,
          base.groundY - portalHeight * 0.64,
        );
        context.lineTo(base.x + portalHalf, base.groundY + 2);
        context.stroke();
        const portalTextureVisibility = 0.18 * farFade(object.z, 520, 860);
        if (concretePattern && portalTextureVisibility > 0.001) {
          context.globalAlpha = visibility * portalTextureVisibility;
          transformObjectPattern(
            concretePattern,
            base.x - portalHalf,
            base.groundY - portalHeight * 1.2,
            base.scale,
            4,
            4,
          );
          context.strokeStyle = concretePattern;
          context.stroke();
        }
        const lampY = base.groundY - portalHeight * 0.72;
        for (const offset of [-2.25, 0, 2.25]) {
          const lampX = base.x + offset * base.scale;
          context.fillStyle = "#e1f5f5";
          context.fillRect(lampX - 1.3, lampY - 0.7, 2.6, 1.4);
          drawGlowDot(
            lampX,
            lampY,
            clamp(base.scale * 1.25, 4, 34),
            `rgba(133, 218, 236, ${0.28 * detailVisibility})`,
          );
        }
        context.restore();
      }
      return;
    }

    const height = 7.5 + object.level * 1.15;
    const deckY = base.groundY - height * base.scale;
    const deckHalfWidth = Math.max(
      47 * base.scale,
      cssWidth * 0.58 + Math.abs(base.x - cssWidth * 0.5),
    );
    const thickness = clamp(1.35 * base.scale, 2, cssHeight * 0.18);
    const pierWidth = clamp(base.scale * 2.7, 2, cssWidth * 0.2);
    const overpassGroundY =
      base.groundY + (8.4 + object.level * 0.72) * base.scale;
    const pierTopY = deckY + thickness * 0.68;
    const pierBottomY = overpassGroundY;
    const pierHeight = Math.max(0, pierBottomY - pierTopY);
    const pierVisibility = (pierX: number): number => {
      const horizontalOverlap = Math.min(
        pierX + pierWidth * 0.5 + 24,
        cssWidth + 24 - (pierX - pierWidth * 0.5),
      );
      const verticalOverlap = Math.min(
        pierBottomY + 24,
        cssHeight + 24 - pierTopY,
      );
      return (
        visibility *
        smoothstep(0, clamp(cssWidth * 0.065, 30, 82), horizontalOverlap) *
        smoothstep(0, clamp(cssHeight * 0.08, 28, 72), verticalOverlap) *
        smoothstep(0.32, 1.15, base.scale * 2.7)
      );
    };
    const deckVisible = deckY + thickness > -24 && deckY < cssHeight + 24;
    const pierVisible = [-13, 13].some((lateral) => {
      const pierX = base.x + lateral * base.scale;
      return (
        pierX + pierWidth * 0.5 > -24 &&
        pierX - pierWidth * 0.5 < cssWidth + 24 &&
        overpassGroundY > -24 &&
        deckY + thickness * 0.68 < cssHeight + 24
      );
    });
    if (!deckVisible && !pierVisible) return;

    const fogAlpha = visibility;
    occludeGlowRect(
      base.x - deckHalfWidth,
      deckY,
      deckHalfWidth * 2,
      thickness,
      visibility,
    );
    for (const lateral of [-13, 13]) {
      const pierX = base.x + lateral * base.scale;
      const supportVisibility = pierVisibility(pierX);
      if (supportVisibility <= 0.001) continue;
      occludeGlowRect(
        pierX - pierWidth * 0.5,
        pierTopY,
        pierWidth,
        pierHeight,
        supportVisibility,
      );
    }
    context.save();
    context.globalAlpha = fogAlpha;
    const deckGradient = context.createLinearGradient(0, deckY, 0, deckY + thickness);
    deckGradient.addColorStop(0, object.level === 1 ? "#465157" : "#3a4449");
    deckGradient.addColorStop(0.28, "#252d31");
    deckGradient.addColorStop(1, "#10161a");
    context.fillStyle = deckGradient;
    context.fillRect(base.x - deckHalfWidth, deckY, deckHalfWidth * 2, thickness);
    const overpassTextureVisibility = 0.16 * farFade(object.z, 560, 920);
    if (metalPattern && overpassTextureVisibility > 0.001) {
      context.globalAlpha = fogAlpha * overpassTextureVisibility;
      metalPattern.setTransform({
        a: (8 * base.scale) / 512,
        b: 0,
        c: 0,
        d: thickness / 512,
        // Keep the repeat origin on the physical centreline. Using the
        // viewport-filling left edge made the texture slide as that edge grew.
        e: base.x,
        f: deckY,
      });
      context.fillStyle = metalPattern;
      context.fillRect(base.x - deckHalfWidth, deckY, deckHalfWidth * 2, thickness);
      context.globalAlpha = fogAlpha;
    }

    context.fillStyle = "rgba(86, 99, 105, 0.86)";
    for (const lateral of [-13, 13]) {
      const pierX = base.x + lateral * base.scale;
      const supportVisibility = pierVisibility(pierX);
      if (supportVisibility <= 0.001) continue;
      context.save();
      context.globalAlpha = supportVisibility;
      context.fillRect(
        pierX - pierWidth * 0.5,
        pierTopY,
        pierWidth,
        pierHeight,
      );
      context.restore();
    }

    context.strokeStyle = "rgba(121, 137, 144, 0.42)";
    context.lineWidth = clamp(base.scale * 0.18, 0.5, 3);
    context.lineCap = "round";
    const ribSpacing = Math.max(7, base.scale * 3.8);
    const firstRib = Math.floor(-deckHalfWidth / ribSpacing);
    const lastRib = Math.ceil(deckHalfWidth / ribSpacing);
    for (let rib = firstRib; rib <= lastRib; rib += 1) {
      const x = base.x + rib * ribSpacing;
      context.beginPath();
      context.moveTo(x, deckY + thickness * 0.15);
      context.lineTo(x + thickness * 0.35, deckY + thickness * 0.88);
      context.stroke();
    }

    const lampCount = quality === "MOBILE" ? 3 : 5;
    for (let lamp = 0; lamp < lampCount; lamp += 1) {
      const x = base.x + (lamp - (lampCount - 1) * 0.5) * base.scale * 6.2;
      const y = deckY + thickness * 0.83;
      context.fillStyle = "rgba(196, 229, 238, 0.88)";
      context.fillRect(x - 1.5, y, 3, Math.max(1, base.scale * 0.12));
      drawGlowDot(
        x,
        y,
        clamp(base.scale * 1.5, 5, 30),
        `rgba(131, 211, 238, ${0.28 * detailVisibility})`,
      );
    }
    context.restore();

  }

  function drawSign(object: Extract<SceneObject, { kind: "sign" }>): void {
    if (roadSigns.length === 0) return;
    const sign = roadSigns[positiveModulo(object.index, roadSigns.length)];
    const roadside = sign.family.startsWith("blue") && positiveModulo(object.index, 3) === 1;
    const roadsideSide: -1 | 1 = object.index % 2 === 0 ? -1 : 1;
    const world = totalDistanceMeters + object.z;
    if (roadside && roadsideSignBlockedByTallWall(world, roadsideSide)) return;
    const lateral = roadside ? roadsideSide * 5.6 : 0;
    const base = projectedAt(object.z, lateral);
    const boardBottomMeters = roadside ? 4.25 : 6.35;
    const boardWidth = sign.widthMeters * base.scale;
    const boardHeight = sign.heightMeters * base.scale;
    const signCenterY =
      base.groundY - (boardBottomMeters + sign.heightMeters * 0.5) * base.scale;
    const boardX = base.x - boardWidth * 0.5;
    const boardY = signCenterY - boardHeight * 0.5;
    const supportSpread = roadside ? 0 : boardWidth * 0.43;
    const poleWidth = clamp(base.scale * 0.16, 0.5, 4);
    const minimumX = Math.min(boardX, base.x - supportSpread) - poleWidth;
    const maximumX = Math.max(boardX + boardWidth, base.x + supportSpread) + poleWidth;
    const minimumY = Math.min(boardY, boardY + boardHeight);
    const maximumY = Math.max(boardY + boardHeight, base.groundY);
    if (
      boardWidth < 0.35 ||
      maximumY < -20 ||
      minimumY > cssHeight + 20 ||
      maximumX < -40 ||
      minimumX > cssWidth + 40
    ) {
      return;
    }

    const visibility = farFade(object.z, FAR_DISTANCE * 0.66, FAR_DISTANCE);
    if (visibility <= 0.002) return;

    occludeGlowRect(boardX, boardY, boardWidth, boardHeight);
    context.save();
    context.globalAlpha = visibility;
    context.strokeStyle = "rgba(118, 132, 135, 0.76)";
    context.lineWidth = poleWidth;
    context.beginPath();
    context.moveTo(base.x - supportSpread, base.groundY);
    context.lineTo(base.x - supportSpread, boardY + boardHeight);
    if (!roadside) {
      context.moveTo(base.x + supportSpread, base.groundY);
      context.lineTo(base.x + supportSpread, boardY + boardHeight);
      const trussY = boardY + boardHeight + clamp(base.scale * 0.38, 0.5, 7);
      context.moveTo(base.x - supportSpread, trussY);
      context.lineTo(base.x + supportSpread, trussY);
    }
    context.stroke();

    context.fillStyle = sign.backgroundColor;
    context.fillRect(boardX, boardY, boardWidth, boardHeight);
    const projectedMax = Math.max(boardWidth, boardHeight) * pixelRatio;
    const detailVisibility = smoothstep(5, 14, projectedMax);
    if (detailVisibility > 0.002) {
      context.globalAlpha = visibility * detailVisibility;
      context.drawImage(
        selectSignMipmap(sign, boardWidth, boardHeight),
        boardX,
        boardY,
        boardWidth,
        boardHeight,
      );
    }
    context.globalAlpha = visibility;
    context.strokeStyle = "rgba(221, 232, 225, 0.46)";
    context.lineWidth = clamp(base.scale * 0.055, 0.35, 1.8);
    context.globalAlpha = visibility * smoothstep(1.8, 7, projectedMax);
    context.strokeRect(boardX, boardY, boardWidth, boardHeight);
    const glowVisibility = smoothstep(2.5, 11, projectedMax);
    if (glowVisibility > 0.002) {
      glowLayer.context.save();
      glowLayer.context.globalAlpha = visibility * glowVisibility;
      drawGlowDot(
        base.x,
        signCenterY,
        clamp(boardWidth * 0.62, 8, 72),
        signGlowColor(sign.family, 0.11),
      );
      glowLayer.context.restore();
    }
    context.restore();
  }

  function drawEmergencyUnit(
    object: Extract<SceneObject, { kind: "emergency-unit" }>,
  ): void {
    const world = totalDistanceMeters + object.z;
    if (roadsideSignBlockedByTallWall(world, object.side)) return;
    const lateral = object.side * (ROAD_HALF_WIDTH + 0.82);
    const base = projectedAt(object.z, lateral);
    const visibility = farFade(object.z, 980, 1_480);
    const cabinetWidth = 0.72 * base.scale;
    const cabinetHeight = 1.38 * base.scale;
    const cabinetBottom = base.groundY - 0.86 * base.scale;
    const cabinetTop = cabinetBottom - cabinetHeight;
    if (
      visibility <= 0.002 ||
      cabinetWidth < 0.45 ||
      base.x + cabinetWidth < -24 ||
      base.x - cabinetWidth > cssWidth + 24
    ) return;

    const postWidth = clamp(base.scale * 0.12, 0.5, 3.2);
    occludeGlowRect(
      base.x - cabinetWidth * 0.58,
      cabinetTop,
      cabinetWidth * 1.16,
      Math.max(cabinetHeight, base.groundY - cabinetTop),
    );
    context.save();
    context.globalAlpha = visibility;
    context.fillStyle = "#707b80";
    context.fillRect(
      base.x - postWidth * 0.5,
      cabinetBottom,
      postWidth,
      Math.max(0, base.groundY - cabinetBottom),
    );
    context.fillStyle = "#e6ecea";
    context.fillRect(
      base.x - cabinetWidth * 0.5,
      cabinetTop,
      cabinetWidth,
      cabinetHeight,
    );
    context.fillStyle = "#1a5e85";
    context.fillRect(
      base.x - cabinetWidth * 0.43,
      cabinetTop + cabinetHeight * 0.08,
      cabinetWidth * 0.86,
      cabinetHeight * 0.56,
    );
    context.fillStyle = "#d8e5e8";
    context.fillRect(
      base.x - cabinetWidth * 0.26,
      cabinetTop + cabinetHeight * 0.18,
      cabinetWidth * 0.52,
      cabinetHeight * 0.18,
    );

    const textVisibility = smoothstep(7, 17, cabinetWidth * pixelRatio);
    if (textVisibility > 0.002) {
      context.globalAlpha = visibility * textVisibility;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = `700 ${clamp(cabinetWidth * 0.23, 6, 18)}px Arial, sans-serif`;
      context.fillStyle = "#c62925";
      context.fillText(
        "SOS",
        base.x,
        cabinetTop + cabinetHeight * 0.49,
      );
      context.font = `600 ${clamp(cabinetWidth * 0.16, 5, 12)}px Arial, sans-serif`;
      context.fillStyle = "#26383f";
      const kilometre = positiveModulo(object.index, 20) * 0.5;
      context.fillText(
        `C1 ${kilometre.toFixed(1)}`,
        base.x,
        cabinetTop + cabinetHeight * 0.79,
      );
    }
    context.restore();
  }

  function vehiclePaint(vehicle: TrafficVehicle): { body: string; highlight: string } {
    if (vehicle.role === "taxi") {
      return { body: "#11191a", highlight: "#426564" };
    }
    if (vehicle.role === "maintenance") {
      return { body: "#b66a1d", highlight: "#f2b24f" };
    }
    if (vehicle.shade < 0.22) return { body: "#181b1e", highlight: "#3a4044" };
    if (vehicle.shade < 0.46) return { body: "#747a7d", highlight: "#aab0b1" };
    if (vehicle.shade < 0.72) return { body: "#d0d1cc", highlight: "#f0eee7" };
    if (vehicle.shade < 0.88) return { body: "#2b3440", highlight: "#596677" };
    return { body: "#6b2220", highlight: "#9a4a43" };
  }

  function drawVehicle(object: Extract<SceneObject, { kind: "vehicle" }>): void {
    const vehicle = object.vehicle;
    const laneCenter = safeVehicleLanePosition(
      vehicle,
      vehicle.lanePosition ?? vehicle.lane * 1.72,
    );
    const base = projectedAt(object.z, laneCenter);
    const dimensions = vehicleDimensions(vehicle.kind);
    const width = dimensions.width * base.scale;
    const height = dimensions.height * base.scale;
    if (base.x + width < -12 || base.x - width > cssWidth + 12) return;
    // Vehicles remain solid silhouettes throughout their visible range. Their
    // apparent depth now comes from scale and haze-coloured lighting, not fade.
    const visibility = 1;

    if (width < 1.25) {
      occludeGlowRect(
        base.x - Math.max(0.7, width * 0.5),
        base.groundY - 2,
        Math.max(1.4, width),
        1.6,
      );
      context.save();
      context.globalAlpha = visibility;
      context.fillStyle = "#151b1f";
      context.fillRect(
        base.x - Math.max(0.7, width * 0.5),
        base.groundY - 2,
        Math.max(1.4, width),
        1.6,
      );
      for (const side of [-1, 1]) {
        const tailX = base.x + side * Math.max(0.55, width * 0.34);
        context.fillStyle = "rgba(255, 56, 42, 0.92)";
        context.fillRect(tailX - 0.55, base.groundY - 1.2, 1.1, 1.1);
        drawGlowDot(
          tailX,
          base.groundY - 0.6,
          2.4,
          `rgba(255, 35, 24, ${0.34 * visibility})`,
        );
      }
      context.restore();
      return;
    }

    context.save();
    context.globalAlpha = visibility;

    const bottom = base.groundY - base.scale * 0.05;
    const left = base.x - width * 0.5;
    const top = bottom - height;
    const paint = vehiclePaint(vehicle);
    const vehicleSilhouette: ReadonlyArray<readonly [number, number]> =
      vehicle.kind === "truck"
        ? [
            [left, top],
            [left + width, top],
            [left + width, bottom],
            [left, bottom],
          ]
        : [
            [left, bottom],
            [left + width * 0.06, top + height * 0.38],
            [left + width * 0.23, top + height * 0.08],
            [left + width * 0.77, top + height * 0.08],
            [left + width * 0.94, top + height * 0.38],
            [left + width, bottom],
          ];
    occludeGlowPolygon(vehicleSilhouette);

    context.fillStyle = "rgba(0, 0, 0, 0.45)";
    context.beginPath();
    context.ellipse(
      base.x,
      bottom + clamp(base.scale * 0.08, 0.5, 4),
      width * 0.58,
      clamp(base.scale * 0.22, 1, 10),
      0,
      0,
      TAU,
    );
    context.fill();

    if (vehicle.kind === "truck") {
      const bodyGradient = context.createLinearGradient(left, 0, left + width, 0);
      bodyGradient.addColorStop(0, "#858988");
      bodyGradient.addColorStop(0.5, vehicle.shade > 0.5 ? "#d0d1ca" : "#9ca09e");
      bodyGradient.addColorStop(1, "#6b7070");
      context.fillStyle = bodyGradient;
      context.fillRect(left, top, width, height * 0.91);
      context.strokeStyle = "rgba(44, 48, 49, 0.7)";
      context.lineWidth = clamp(base.scale * 0.07, 0.5, 2.2);
      context.strokeRect(left + width * 0.06, top + height * 0.06, width * 0.88, height * 0.74);
      context.beginPath();
      context.moveTo(base.x, top + height * 0.06);
      context.lineTo(base.x, top + height * 0.8);
      context.stroke();
      context.fillStyle = "#202427";
      context.fillRect(left + width * 0.05, bottom - height * 0.12, width * 0.9, height * 0.12);
    } else {
      context.fillStyle = paint.body;
      fillPolygon(context, vehicleSilhouette);
      context.fillStyle = "rgba(5, 11, 15, 0.93)";
      fillPolygon(context, [
        [left + width * 0.24, top + height * 0.15],
        [left + width * 0.76, top + height * 0.15],
        [left + width * 0.86, top + height * 0.43],
        [left + width * 0.14, top + height * 0.43],
      ]);
      context.strokeStyle = paint.highlight;
      context.lineWidth = clamp(base.scale * 0.055, 0.4, 1.6);
      context.beginPath();
      context.moveTo(left + width * 0.08, top + height * 0.5);
      context.lineTo(left + width * 0.92, top + height * 0.5);
      context.stroke();
      context.fillStyle = "rgba(12, 15, 17, 0.82)";
      context.fillRect(left + width * 0.04, bottom - height * 0.18, width * 0.92, height * 0.13);
    }

    if (vehicle.role === "taxi") {
      const roofLampWidth = clamp(width * 0.24, 2, 18);
      const roofLampHeight = clamp(height * 0.075, 1, 6);
      const roofLampY = top - roofLampHeight * 0.08;
      context.fillStyle = "rgba(174, 236, 216, 0.96)";
      context.fillRect(
        base.x - roofLampWidth * 0.5,
        roofLampY,
        roofLampWidth,
        roofLampHeight,
      );
      drawGlowDot(
        base.x,
        roofLampY + roofLampHeight * 0.5,
        clamp(base.scale * 0.72, 2, 15),
        "rgba(112, 228, 196, 0.18)",
      );
    } else if (
      vehicle.role === "maintenance" &&
      positiveModulo(elapsedTime, 0.74) < 0.43
    ) {
      const beaconWidth = clamp(width * 0.2, 2, 15);
      const beaconHeight = clamp(height * 0.09, 1, 7);
      const beaconY = top - beaconHeight * 0.12;
      context.fillStyle = "rgba(255, 171, 38, 0.98)";
      context.fillRect(
        base.x - beaconWidth * 0.5,
        beaconY,
        beaconWidth,
        beaconHeight,
      );
      drawGlowDot(
        base.x,
        beaconY + beaconHeight * 0.5,
        clamp(base.scale * 2.1, 4, 34),
        "rgba(255, 130, 20, 0.42)",
      );
    }

    const tailY = vehicle.kind === "truck"
      ? bottom - height * 0.13
      : bottom - height * 0.23;
    const tailOffset = width * (vehicle.kind === "truck" ? 0.34 : 0.32);
    // Keep the lamps proportional to the body in the near field. The previous
    // low pixel caps made them appear to shrink as the camera overtook a car.
    const tailWidth = clamp(
      width * (vehicle.kind === "truck" ? 0.13 : 0.145),
      1,
      64,
    );
    const tailHeight = clamp(
      height * (vehicle.kind === "truck" ? 0.08 : 0.1),
      1,
      32,
    );
    for (const side of [-1, 1]) {
      const tailX = base.x + side * tailOffset;
      context.fillStyle = "#f13b2f";
      context.fillRect(tailX - tailWidth * 0.5, tailY, tailWidth, tailHeight);
      drawGlowDot(
        tailX,
        tailY + tailHeight * 0.5,
        clamp(
          width * (vehicle.kind === "truck" ? 0.23 : 0.28),
          2.2,
          56,
        ),
        `rgba(255, 34, 22, ${0.36 * visibility})`,
      );
    }

    if (
      vehicle.signalSide !== undefined &&
      positiveModulo(elapsedTime, 0.82) < 0.46
    ) {
      const signalX =
        base.x + (vehicle.signalSide ?? 1) * tailOffset;
      context.fillStyle = "rgba(255, 166, 38, 0.98)";
      context.fillRect(
        signalX - tailWidth * 0.42,
        tailY - tailHeight * 0.08,
        tailWidth * 0.84,
        tailHeight * 1.16,
      );
      drawGlowDot(
        signalX,
        tailY + tailHeight * 0.5,
        clamp(base.scale * 0.9, 3, 20),
        "rgba(255, 140, 28, 0.34)",
      );
    }

    const plateWidth = clamp(width * 0.19, 2, 18);
    const plateHeight = clamp(height * 0.055, 1, 6);
    context.fillStyle = "rgba(212, 221, 203, 0.88)";
    context.fillRect(base.x - plateWidth * 0.5, bottom - height * 0.12, plateWidth, plateHeight);

    if (vehicle.kind === "truck") {
      context.fillStyle = "#e2c934";
      context.fillRect(left + width * 0.08, bottom - height * 0.035, width * 0.84, Math.max(1, height * 0.025));
      context.fillStyle = "#d94b31";
      for (let stripe = 0; stripe < 5; stripe += 1) {
        context.fillRect(
          left + width * (0.1 + stripe * 0.17),
          bottom - height * 0.04,
          width * 0.08,
          Math.max(1, height * 0.035),
        );
      }
    }
    context.restore();
  }

  function drawBollard(object: Extract<SceneObject, { kind: "bollard" }>): void {
    const lateral = object.side * 3.18;
    const base = projectedAt(object.z, lateral);
    const top = projectedAt(object.z, lateral, 0.82);
    const height = base.groundY - top.y;
    if (height < 0.45 || base.x < -16 || base.x > cssWidth + 16) return;
    const width = clamp(base.scale * 0.095, 0.65, 8.5);
    const visibility =
      farFade(object.z, 900, FAR_DISTANCE) *
      smoothstep(0.35, 1.5, height);
    occludeGlowRect(
      base.x - width,
      top.y - width * 0.55,
      width * 2,
      base.groundY - top.y + width * 0.55,
    );
    context.save();
    context.globalAlpha = visibility;
    context.strokeStyle = "rgba(238, 239, 228, 0.95)";
    context.lineWidth = width;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(base.x, base.groundY);
    context.lineTo(top.x, top.y);
    context.stroke();
    context.strokeStyle = "rgba(221, 72, 43, 0.96)";
    context.lineWidth = width * 1.04;
    for (const ratio of [0.2, 0.48, 0.76]) {
      const y = lerp(base.groundY, top.y, ratio);
      context.beginPath();
      context.moveTo(base.x - width * 0.22, y);
      context.lineTo(base.x + width * 0.22, y - width * 0.2);
      context.stroke();
    }
    context.fillStyle = "rgba(236, 238, 220, 0.96)";
    context.beginPath();
    context.ellipse(top.x, top.y, width * 0.8, width * 0.5, 0, 0, TAU);
    context.fill();
    drawGlowDot(top.x, top.y, clamp(base.scale * 0.7, 2, 13), "rgba(211, 230, 220, 0.2)");
    context.restore();
  }

  function drawSceneObject(object: SceneObject): void {
    if (object.kind === "light") drawStreetLight(object);
    else if (object.kind === "sign") drawSign(object);
    else if (object.kind === "overpass") drawOverpass(object);
    else if (object.kind === "emergency-unit") drawEmergencyUnit(object);
    else if (object.kind === "bollard") drawBollard(object);
    else drawVehicle(object);
  }

  function drawDepthSceneItem(item: DepthSceneItem): void {
    if (item.source === "city") drawCityLayerItem(item.item);
    else drawSceneObject(item.object);
  }

  function drawBarrierSegment(
    far: RoadPoint,
    near: RoadPoint,
    side: -1 | 1,
    wallHeight: number,
    color: string,
    texture: CanvasPattern | null,
    alpha: number,
  ): void {
    const lateral = side * (ROAD_HALF_WIDTH + 0.72);
    const farX = far.center + lateral * far.scale;
    const nearX = near.center + lateral * near.scale;
    const farTop = far.y - wallHeight * far.scale;
    const nearTop = near.y - wallHeight * near.scale;
    const extendLine = (
      farLineX: number,
      farLineY: number,
      nearLineX: number,
      nearLineY: number,
    ): readonly [number, number, number, number] => {
      const length = Math.max(0.001, Math.hypot(nearLineX - farLineX, nearLineY - farLineY));
      const overlap = 0.72;
      const unitX = (nearLineX - farLineX) / length;
      const unitY = (nearLineY - farLineY) / length;
      return [
        farLineX - unitX * overlap,
        farLineY - unitY * overlap,
        nearLineX + unitX * overlap,
        nearLineY + unitY * overlap,
      ];
    };
    const [farBaseX, farBaseY, nearBaseX, nearBaseY] = extendLine(
      farX,
      far.y,
      nearX,
      near.y + 0.28,
    );
    const [farEdgeX, farEdgeY, nearEdgeX, nearEdgeY] = extendLine(
      farX,
      farTop,
      nearX,
      nearTop,
    );
    const wallPolygon: ReadonlyArray<readonly [number, number]> = [
      [farBaseX, farBaseY],
      [farEdgeX, farEdgeY],
      [nearEdgeX, nearEdgeY],
      [nearBaseX, nearBaseY],
    ];
    const texturePolygon: ReadonlyArray<readonly [number, number]> = [
      [farX, far.y],
      [farX, farTop],
      [nearX, nearTop],
      [nearX, near.y + 0.28],
    ];
    const projectedHeight = wallHeight * near.scale;
    const visibility =
      alpha *
      smoothstep(0.16, 0.72, projectedHeight) *
      farFade(near.z, FAR_DISTANCE * 0.82, FAR_DISTANCE);
    if (visibility <= 0.002) return;

    occludeGlowPolygon(wallPolygon);
    context.save();
    context.globalAlpha = visibility;
    context.fillStyle = color;
    fillPolygon(context, wallPolygon);
    const textureVisibility = farFade(near.z, 600, 920) * 0.27;
    if (texture && textureVisibility > 0.001) {
      context.globalAlpha = visibility * textureVisibility;
      transformWallPattern(
        texture,
        far,
        near,
        side,
        512,
        512,
        wallHeight,
        4,
        1.8,
      );
      context.fillStyle = texture;
      fillPolygon(context, texturePolygon);
    }
    context.globalAlpha = visibility;
    context.strokeStyle = "rgba(204, 216, 218, 0.58)";
    context.lineWidth = clamp(near.scale * 0.065, 0.42, 2.2);
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(farEdgeX, farEdgeY);
    context.lineTo(nearEdgeX, nearEdgeY);
    context.stroke();
    context.restore();
  }

  function drawChevronPanels(
    far: RoadPoint,
    near: RoadPoint,
    side: -1 | 1,
    wallHeight: number,
    visibility: number,
  ): void {
    const lateral = side * (ROAD_HALF_WIDTH + 0.72);
    const farX = far.center + lateral * far.scale;
    const nearX = near.center + lateral * near.scale;
    const farTop = far.y - wallHeight * far.scale;
    const nearTop = near.y - wallHeight * near.scale;
    const clipPolygon: ReadonlyArray<readonly [number, number]> = [
      [farX, far.y],
      [farX, farTop],
      [nearX, nearTop],
      [nearX, near.y + 0.28],
    ];
    const panelLength = 9.6;
    const firstPanel = Math.floor(near.world / panelLength) - 1;
    const lastPanel = Math.floor(far.world / panelLength) + 1;
    const projectPanelPoint = (
      panelNearWorld: number,
      panelFarWorld: number,
      longitudinalRatio: number,
      heightRatio: number,
    ): readonly [number, number] => {
      const world = lerp(panelNearWorld, panelFarWorld, longitudinalRatio);
      const point = projectedAt(world - totalDistanceMeters, lateral);
      return [
        point.x,
        point.groundY - wallHeight * point.scale * heightRatio,
      ];
    };

    context.save();
    context.beginPath();
    context.moveTo(clipPolygon[0][0], clipPolygon[0][1]);
    for (let index = 1; index < clipPolygon.length; index += 1) {
      context.lineTo(clipPolygon[index][0], clipPolygon[index][1]);
    }
    context.closePath();
    context.clip();
    context.globalAlpha = visibility;
    context.fillStyle = "#bd2f29";

    for (let panel = firstPanel; panel <= lastPanel; panel += 1) {
      const panelNearWorld = panel * panelLength;
      const panelFarWorld = panelNearWorld + panelLength;
      if (panelFarWorld < near.world || panelNearWorld > far.world) continue;
      // Every panel points forward along the carriageway. Perspective turns
      // that single physical direction into the correct left/right screen
      // direction on curves; alternating it by mesh cell was visually false.
      fillPolygon(context, [
        projectPanelPoint(panelNearWorld, panelFarWorld, 0.08, 0.1),
        projectPanelPoint(panelNearWorld, panelFarWorld, 0.5, 0.1),
        projectPanelPoint(panelNearWorld, panelFarWorld, 0.94, 0.5),
        projectPanelPoint(panelNearWorld, panelFarWorld, 0.5, 0.9),
        projectPanelPoint(panelNearWorld, panelFarWorld, 0.08, 0.9),
        projectPanelPoint(panelNearWorld, panelFarWorld, 0.48, 0.5),
      ]);
    }
    context.restore();
  }

  function drawBarrierSlice(far: RoadPoint, near: RoadPoint): void {
    if (far.z <= near.z + 0.0001) return;
    const world = (far.world + near.world) * 0.5;
    const location = locationIndex(world);
    const alternating = (Math.floor(world / 9.6) & 1) === 0;
    const chevrons = location === 11 || (location === 0 && locationLocal(world) > 510);
    const soundwall = location === 2 || location === 12;
    const baseTexture = concretePattern;

    for (const side of [-1, 1] as const) {
      const height = side < 0 ? 0.9 : 0.84;
      const baseColor = chevrons
        ? "#b7bcba"
        : side < 0
          ? alternating ? "#596163" : "#4e5658"
          : alternating ? "#60686a" : "#555e60";
      drawBarrierSegment(far, near, side, height, baseColor, baseTexture, 1);

      const detailVisibility = farFade(near.z, 440, 760);
      if (
        Math.floor(far.world / 6.8) !== Math.floor(near.world / 6.8) &&
        detailVisibility > 0.002
      ) {
        const lateral = side * (ROAD_HALF_WIDTH + 0.72);
        const base = projectedAt(near.z, lateral);
        const top = projectedAt(near.z, lateral, height);
        context.save();
        context.globalAlpha = 0.42 * detailVisibility;
        context.strokeStyle = "rgba(28, 39, 43, 0.9)";
        context.lineWidth = clamp(near.scale * 0.035, 0.35, 1.15);
        context.beginPath();
        context.moveTo(base.x, base.groundY);
        context.lineTo(top.x, top.y);
        context.stroke();
        const boltVisibility = farFade(near.z, 210, 340);
        if (boltVisibility > 0.002) {
          context.globalAlpha = 0.42 * detailVisibility * boltVisibility;
          const boltRadius = clamp(near.scale * 0.022, 0.45, 1.8);
          context.fillStyle = "rgba(207, 216, 214, 0.78)";
          for (const ratio of [0.28, 0.72]) {
            const boltY = lerp(top.y, base.groundY, ratio);
            context.beginPath();
            context.arc(base.x, boltY, boltRadius, 0, TAU);
            context.fill();
          }
        }
        context.restore();
      }

      const chevronVisibility =
        farFade(near.z, 860, FAR_DISTANCE) *
        smoothstep(0.35, 1.5, near.scale * height);
      const screenTurn = far.center - near.center;
      const outsideSide: -1 | 1 = screenTurn < 0 ? 1 : -1;
      if (
        chevrons &&
        Math.abs(screenTurn) > 0.015 &&
        side === outsideSide &&
        chevronVisibility > 0.002
      ) {
        drawChevronPanels(
          far,
          near,
          side,
          height,
          chevronVisibility,
        );
      }

      const soundWallHeight = soundBarrierHeightAt(world, side);
      if (soundwall && soundWallHeight > 0) {
        const wallHeight = soundWallHeight;
        drawBarrierSegment(
          far,
          near,
          side,
          wallHeight,
          "#43525a",
          // Perspective-critical panels use geometric posts and a solid body.
          // An affine repeated texture creates diagonal wedges on a tapered
          // wall, even when the wall mesh itself is continuous.
          null,
          1,
        );
        const soundPostVisibility = farFade(near.z, 490, 820);
        if (
          Math.floor(far.world / 8.4) !== Math.floor(near.world / 8.4) &&
          soundPostVisibility > 0.002
        ) {
          const lateral = side * (ROAD_HALF_WIDTH + 0.72);
          const base = projectedAt(near.z, lateral);
          const top = projectedAt(near.z, lateral, wallHeight);
          context.save();
          context.globalAlpha = soundPostVisibility;
          context.strokeStyle = "rgba(139, 155, 162, 0.7)";
          context.lineWidth = clamp(near.scale * 0.105, 0.45, 3);
          context.beginPath();
          context.moveTo(base.x, base.groundY);
          context.lineTo(top.x, top.y);
          context.stroke();
          context.restore();
        }
      }
    }
  }

  function drawDepthScene(): void {
    depthSceneItems.length = 0;
    for (const item of cityLayerItems) {
      if (item.z >= NEAR_DISTANCE && item.z <= CITY_FAR_DISTANCE) {
        depthSceneItems.push({ source: "city", z: item.z, item });
      }
    }
    for (const object of sceneObjects) {
      depthSceneItems.push({ source: "road", z: object.z, object });
    }
    depthSceneItems.sort((first, second) => second.z - first.z);

    const drawRoadInterval = (far: RoadPoint, near: RoadPoint): void => {
      if (far.z <= near.z + 0.0001) return;
      drawRoadSurfaceSlice(far, near);
      drawRoadMarkingsSlice(far, near);
      drawBarrierSlice(far, near);
    };

    let itemIndex = 0;
    for (let index = roadPoints.length - 1; index >= 1; index -= 1) {
      const far = roadPoints[index];
      const near = roadPoints[index - 1];

      while (
        itemIndex < depthSceneItems.length &&
        depthSceneItems[itemIndex].z > far.z
      ) {
        drawDepthSceneItem(depthSceneItems[itemIndex]);
        itemIndex += 1;
      }

      let intervalFar = far;
      while (
        itemIndex < depthSceneItems.length &&
        depthSceneItems[itemIndex].z > near.z
      ) {
        const item = depthSceneItems[itemIndex];
        const split = roadPointAt(clamp(item.z, near.z, intervalFar.z));
        drawRoadInterval(intervalFar, split);
        drawDepthSceneItem(item);
        intervalFar = split;
        itemIndex += 1;
      }

      drawRoadInterval(intervalFar, near);
    }

    while (itemIndex < depthSceneItems.length) {
      drawDepthSceneItem(depthSceneItems[itemIndex]);
      itemIndex += 1;
    }

    for (const [key, trail] of lightTrailPositions) {
      if (frameNumber - trail.frame > 3) lightTrailPositions.delete(key);
    }
    while (lightTrailPositions.size > MAX_LIGHT_TRAIL_HISTORY) {
      const oldestKey = lightTrailPositions.keys().next().value;
      if (oldestKey === undefined) break;
      lightTrailPositions.delete(oldestKey);
    }
  }

  function drawHeadlightReflections(): void {
    if (
      !leftHeadlightWashCache ||
      !rightHeadlightWashCache ||
      !roadSheenCache
    ) rebuildStaticGradients();
    context.save();
    context.globalCompositeOperation = "screen";
    context.fillStyle = leftHeadlightWashCache ?? "rgba(0, 0, 0, 0)";
    context.fillRect(0, horizon, cssWidth, cssHeight - horizon);

    context.fillStyle = rightHeadlightWashCache ?? "rgba(0, 0, 0, 0)";
    context.fillRect(0, horizon, cssWidth, cssHeight - horizon);

    // A radial pool has no hard x-boundaries, avoiding the vertical seams that
    // the previous cropped sheen rectangle exposed at the bottom of the frame.
    context.fillStyle = roadSheenCache ?? "rgba(0, 0, 0, 0)";
    context.fillRect(0, horizon, cssWidth, cssHeight - horizon);
    context.restore();
  }

  function compositeBloom(): void {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = "screen";
    context.globalAlpha = quality === "MOBILE" ? 0.68 : 0.82;
    context.filter = `blur(${Math.max(3, Math.round(pixelRatio * (quality === "MOBILE" ? 4 : 7)))}px)`;
    context.drawImage(
      glowLayer.canvas,
      0,
      0,
      glowLayer.canvas.width,
      glowLayer.canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    context.filter = "none";
    context.globalAlpha = 0.28;
    context.drawImage(
      glowLayer.canvas,
      0,
      0,
      glowLayer.canvas.width,
      glowLayer.canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    context.restore();
    configureContextTransforms();
  }

  function drawAtmosphereAndGrain(): void {
    if (!distanceFogCache || !vignetteCache) rebuildStaticGradients();
    context.fillStyle = distanceFogCache ?? "rgba(0, 0, 0, 0)";
    context.fillRect(0, horizon - cssHeight * 0.1, cssWidth, cssHeight * 0.34);

    context.fillStyle = vignetteCache ?? "rgba(0, 0, 0, 0)";
    context.fillRect(0, 0, cssWidth, cssHeight);

    if (frameNumber % (quality === "MOBILE" ? 12 : 7) === 0) {
      regenerateNoise(frameNumber);
    }
    if (noisePattern) {
      context.save();
      context.globalAlpha = quality === "MOBILE" ? 0.24 : 0.31;
      context.globalCompositeOperation = "soft-light";
      context.translate(-positiveModulo(frameNumber * 17, 128), -positiveModulo(frameNumber * 11, 128));
      context.fillStyle = noisePattern;
      context.fillRect(0, 0, cssWidth + 128, cssHeight + 128);
      context.restore();
    }
  }

  function renderFrame(): void {
    if (destroyed || cssWidth <= 0 || cssHeight <= 0) return;
    directorState = sampleDriveDirector(journeyDistanceMeters, sessionSeed);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    clearGlow();
    drawSky();
    buildRoadPoints();
    collectCityLayerItems();
    collectSceneObjects();
    drawDepthScene();
    drawHeadlightReflections();
    compositeBloom();
    drawAtmosphereAndGrain();
  }

  function recycleVehicle(vehicle: TrafficVehicle): void {
    vehicle.generation += 1;
    const seed = vehicle.id * 131 + vehicle.generation * 19;
    const farthestVehicle = Math.max(360, ...vehicles.map((item) => item.z));
    const minimumGap = lerp(112, 52, directorState.intensity);
    const gapVariation = lerp(205, 118, directorState.intensity);
    vehicle.z = farthestVehicle + minimumGap + seeded(seed, 367) * gapVariation;
    vehicle.lane = seeded(seed, 373) > 0.5 ? 1 : -1;
    vehicle.lanePosition = undefined;
    vehicle.closingSpeed = 0.5 + seeded(seed, 379) * 2.2;
    const kindRoll = seeded(seed, 383);
    vehicle.kind = kindRoll > 0.87 ? "truck" : kindRoll > 0.62 ? "minivan" : "sedan";
    vehicle.shade = seeded(seed, 389);
    vehicle.role = "ambient";
    vehicle.signalSide = undefined;
    vehicle.avoidanceFromLateral = undefined;
    vehicle.avoidanceToLateral = undefined;
    vehicle.avoidanceProgress = undefined;
    vehicle.avoidanceDuration = undefined;
    scheduleAmbientManeuver(vehicle, seed);
  }

  function updateVehicles(deltaSeconds: number): void {
    const paceFactor = 0.7 + speedKmh / 165;
    const obstacle = directorState.event
      ? scriptedRoadObstaclePose(directorState.event)
      : null;
    const obstacleLateral = obstacle
      ? safeVehicleLanePosition(obstacle, obstacle.lateral)
      : 0;
    for (const vehicle of vehicles) {
      vehicle.z -= vehicle.closingSpeed * paceFactor * deltaSeconds;

      // Do not let a decorative ambient lane change steer a car into the
      // stopped-object corridor. If one has already started, ease it back to
      // the clear lane instead of snapping its lateral position.
      if (
        obstacle &&
        vehicle.laneChangeTo !== undefined &&
        roadObstacleRequiresAvoidance(
          vehicle.z,
          safeVehicleLanePosition(
            vehicle,
            vehicle.laneChangeTo * OVERTAKE_LANE_OFFSET_METERS,
          ),
          vehicle.kind,
          obstacle.z,
          obstacleLateral,
          obstacle.kind,
        )
      ) {
        const currentLateral = safeVehicleLanePosition(
          vehicle,
          vehicle.lanePosition ??
            (vehicle.laneChangeFrom ?? vehicle.lane) *
              OVERTAKE_LANE_OFFSET_METERS,
        );
        const clearLateral =
          obstacleLateral >= 0
            ? -OVERTAKE_LANE_OFFSET_METERS
            : OVERTAKE_LANE_OFFSET_METERS;
        vehicle.laneChangeFrom = undefined;
        vehicle.laneChangeTo = undefined;
        vehicle.laneChangeStartZ = undefined;
        vehicle.laneChangeEndZ = undefined;
        vehicle.avoidanceFromLateral = currentLateral;
        vehicle.avoidanceToLateral = clearLateral;
        vehicle.avoidanceProgress = 0;
        vehicle.avoidanceDuration = 2.1;
        vehicle.lanePosition = currentLateral;
      }
      if (
        vehicle.laneChangeFrom !== undefined &&
        vehicle.laneChangeTo !== undefined &&
        vehicle.laneChangeStartZ !== undefined &&
        vehicle.laneChangeEndZ !== undefined
      ) {
        const laneChangeProgress = smoothstep(
          0,
          1,
          (vehicle.laneChangeStartZ - vehicle.z) /
            Math.max(
              0.001,
              vehicle.laneChangeStartZ - vehicle.laneChangeEndZ,
            ),
        );
        vehicle.lanePosition = lerp(
          vehicle.laneChangeFrom * 1.72,
          vehicle.laneChangeTo * 1.72,
          laneChangeProgress,
        );
        if (vehicle.z <= vehicle.laneChangeEndZ) {
          vehicle.lane = vehicle.laneChangeTo;
          vehicle.lanePosition = undefined;
          vehicle.laneChangeFrom = undefined;
          vehicle.laneChangeTo = undefined;
          vehicle.laneChangeStartZ = undefined;
          vehicle.laneChangeEndZ = undefined;
        }
      }

      if (
        vehicle.avoidanceFromLateral !== undefined &&
        vehicle.avoidanceToLateral !== undefined &&
        vehicle.avoidanceProgress !== undefined &&
        vehicle.avoidanceDuration !== undefined
      ) {
        vehicle.avoidanceProgress = clamp(
          vehicle.avoidanceProgress +
            deltaSeconds / Math.max(0.001, vehicle.avoidanceDuration),
          0,
          1,
        );
        vehicle.lanePosition = smoothPassingLateral(
          vehicle.avoidanceFromLateral,
          vehicle.avoidanceToLateral,
          vehicle.avoidanceProgress,
        );
        vehicle.signalSide = vehicle.avoidanceToLateral >= 0 ? 1 : -1;
        if (vehicle.avoidanceProgress >= 1) {
          vehicle.lane = vehicle.avoidanceToLateral >= 0 ? 1 : -1;
          vehicle.lanePosition = undefined;
          vehicle.signalSide = undefined;
          vehicle.avoidanceFromLateral = undefined;
          vehicle.avoidanceToLateral = undefined;
          vehicle.avoidanceProgress = undefined;
          vehicle.avoidanceDuration = undefined;
        }
      } else if (obstacle) {
        const currentLateral = safeVehicleLanePosition(
          vehicle,
          vehicle.lanePosition ??
            vehicle.lane * OVERTAKE_LANE_OFFSET_METERS,
        );
        if (
          roadObstacleRequiresAvoidance(
            vehicle.z,
            currentLateral,
            vehicle.kind,
            obstacle.z,
            obstacleLateral,
            obstacle.kind,
          )
        ) {
          const targetLateral =
            obstacleLateral >= 0
              ? -OVERTAKE_LANE_OFFSET_METERS
              : OVERTAKE_LANE_OFFSET_METERS;
          let targetLaneBlocked = false;
          for (const other of vehicles) {
            if (other === vehicle) continue;
            const otherLateral = safeVehicleLanePosition(
              other,
              other.lanePosition ??
                other.lane * OVERTAKE_LANE_OFFSET_METERS,
            );
            if (
              avoidanceLaneBlockedByVehicle(
                vehicle.z,
                targetLateral,
                vehicle.kind,
                other.z,
                otherLateral,
                other.kind,
              )
            ) {
              targetLaneBlocked = true;
              break;
            }
          }
          if (!targetLaneBlocked) {
            const avoidanceDuration =
              2.35 + seeded(vehicle.id + vehicle.generation * 29, 431) * 0.5;
            vehicle.avoidanceFromLateral = currentLateral;
            vehicle.avoidanceToLateral = targetLateral;
            vehicle.avoidanceProgress = 0;
            vehicle.avoidanceDuration = avoidanceDuration;
            vehicle.signalSide = targetLateral >= 0 ? 1 : -1;
            vehicle.laneChangeFrom = undefined;
            vehicle.laneChangeTo = undefined;
            vehicle.laneChangeStartZ = undefined;
            vehicle.laneChangeEndZ = undefined;
          }
        }
      }

      if (obstacle) {
        const currentLateral = safeVehicleLanePosition(
          vehicle,
          vehicle.lanePosition ??
            vehicle.lane * OVERTAKE_LANE_OFFSET_METERS,
        );
        vehicle.z = safeRoadObstacleFollowingZ(
          vehicle.z,
          currentLateral,
          vehicle.kind,
          obstacle.z,
          obstacleLateral,
          obstacle.kind,
        );
      }
      if (vehicle.z < -16) recycleVehicle(vehicle);
    }

    // Keep ordinary traffic ordered while vehicles queue behind an incident
    // or cross between lanes. Without this second pass, several cars can pick
    // the same stopping point and visually occupy one another.
    ambientTrafficOrder.sort((a, b) => b.z - a.z || a.id - b.id);
    for (let index = 1; index < ambientTrafficOrder.length; index += 1) {
      const follower = ambientTrafficOrder[index];
      const followerLateral = safeVehicleLanePosition(
        follower,
        follower.lanePosition ??
          follower.lane * OVERTAKE_LANE_OFFSET_METERS,
      );
      for (let leaderIndex = index - 1; leaderIndex >= 0; leaderIndex -= 1) {
        const leader = ambientTrafficOrder[leaderIndex];
        const leaderLateral = safeVehicleLanePosition(
          leader,
          leader.lanePosition ??
            leader.lane * OVERTAKE_LANE_OFFSET_METERS,
        );
        const safeZ = safeRoadObstacleFollowingZ(
          follower.z,
          followerLateral,
          follower.kind,
          leader.z,
          leaderLateral,
          leader.kind,
        );
        if (safeZ < follower.z) {
          follower.z = safeZ;
          break;
        }
      }
    }
  }

  function routeAndScene(): { routeName: string; sceneName: string } {
    const block = Math.floor(totalDistanceMeters / LOCATION_LENGTH);
    return {
      routeName: ROUTE_NAMES[positiveModulo(block, ROUTE_NAMES.length)],
      sceneName: LOCATION_NAMES[locationIndex(totalDistanceMeters)],
    };
  }

  function emitTelemetry(timestamp: number): void {
    if (timestamp - lastTelemetryTime < 250) return;
    lastTelemetryTime = timestamp;
    const route = routeAndScene();
    onTelemetry({
      speedKmh: Math.round(speedKmh),
      distanceKm: Math.round((journeyDistanceMeters / 1000) * 100) / 100,
      routeName: route.routeName,
      sceneName: route.sceneName,
      fps: Math.round(smoothedFps),
      quality,
    });
  }

  function audioTargetGain(): number {
    if (!soundEnabled || paused || hidden) return 0.0001;
    return lerp(0.036, 0.052, directorState.intensity);
  }

  function applyAudioGain(): void {
    if (!audioRig) return;
    const now = audioRig.context.currentTime;
    audioRig.master.gain.cancelScheduledValues(now);
    audioRig.master.gain.setValueAtTime(
      Math.max(0.0001, audioRig.master.gain.value),
      now,
    );
    audioRig.master.gain.exponentialRampToValueAtTime(audioTargetGain(), now + 0.18);
  }

  function createAudioRig(): AudioRig {
    const audioContext = new AudioContext();
    const master = audioContext.createGain();
    const engineGain = audioContext.createGain();
    const engineOscillator = audioContext.createOscillator();
    const subOscillator = audioContext.createOscillator();
    const engineFilter = audioContext.createBiquadFilter();
    const roadGain = audioContext.createGain();
    const roadNoise = audioContext.createBufferSource();
    const roadFilter = audioContext.createBiquadFilter();

    master.gain.value = 0.0001;
    engineGain.gain.value = 0.58;
    roadGain.gain.value = 0.38;
    engineOscillator.type = "triangle";
    subOscillator.type = "sine";
    engineOscillator.frequency.value = 66;
    subOscillator.frequency.value = 33;
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 240;
    engineFilter.Q.value = 0.7;
    roadFilter.type = "bandpass";
    roadFilter.frequency.value = 760;
    roadFilter.Q.value = 0.52;

    const noiseLength = Math.max(1, Math.floor(audioContext.sampleRate * 2));
    const noiseBuffer = audioContext.createBuffer(1, noiseLength, audioContext.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.76 + white * 0.24;
      data[index] = previous;
    }
    roadNoise.buffer = noiseBuffer;
    roadNoise.loop = true;

    engineOscillator.connect(engineFilter);
    subOscillator.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    roadNoise.connect(roadFilter);
    roadFilter.connect(roadGain);
    roadGain.connect(master);
    master.connect(audioContext.destination);
    engineOscillator.start();
    subOscillator.start();
    roadNoise.start();

    return {
      context: audioContext,
      master,
      engineGain,
      engineOscillator,
      subOscillator,
      engineFilter,
      roadGain,
      roadNoise,
      roadFilter,
    };
  }

  function updateAudio(timestamp: number): void {
    if (!audioRig || timestamp - audioUpdateTime < 90) return;
    audioUpdateTime = timestamp;
    const now = audioRig.context.currentTime;
    const normalizedSpeed = clamp((speedKmh - 30) / 150, 0, 1);
    const engineFrequency = 48 + normalizedSpeed * 46;
    audioRig.engineOscillator.frequency.setTargetAtTime(engineFrequency, now, 0.08);
    audioRig.subOscillator.frequency.setTargetAtTime(engineFrequency * 0.5, now, 0.1);
    audioRig.engineFilter.frequency.setTargetAtTime(190 + normalizedSpeed * 170, now, 0.12);
    audioRig.roadFilter.frequency.setTargetAtTime(520 + normalizedSpeed * 720, now, 0.14);
    audioRig.roadGain.gain.setTargetAtTime(
      (0.2 + normalizedSpeed * 0.3) * lerp(0.82, 1.12, directorState.intensity),
      now,
      0.15,
    );
  }

  function scheduleFrame(): void {
    if (
      animationFrame === 0 &&
      started &&
      !destroyed &&
      !paused &&
      !hidden
    ) {
      animationFrame = window.requestAnimationFrame(frame);
    }
  }

  function frame(timestamp: number): void {
    animationFrame = 0;
    if (!started || destroyed || paused || hidden) return;

    const elapsedMilliseconds = lastFrameTime === 0 ? 16.67 : timestamp - lastFrameTime;
    lastFrameTime = timestamp;
    const deltaSeconds = clamp(elapsedMilliseconds / 1000, 0, 0.05);
    const instantaneousFps = 1000 / Math.max(1, elapsedMilliseconds);
    smoothedFps = lerp(smoothedFps, instantaneousFps, 0.075);
    elapsedTime = positiveModulo(elapsedTime + deltaSeconds, 86_400);
    const travelledMeters = (speedKmh / 3.6) * deltaSeconds;
    totalDistanceMeters += travelledMeters;
    journeyDistanceMeters += travelledMeters;
    directorState = sampleDriveDirector(journeyDistanceMeters, sessionSeed);
    updateVehicles(deltaSeconds);
    updateAudio(timestamp);
    renderFrame();
    emitTelemetry(timestamp);
    frameNumber += 1;
    scheduleFrame();
  }

  function handleVisibilityChange(): void {
    hidden = document.hidden;
    lastFrameTime = 0;
    if (hidden && animationFrame !== 0) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    applyAudioGain();
    if (!hidden) scheduleFrame();
  }

  function start(): void {
    if (destroyed || started) return;
    started = true;
    lastFrameTime = 0;
    resize();
    emitTelemetry(performance.now());
    scheduleFrame();
  }

  function setPaused(nextPaused: boolean): void {
    if (destroyed || paused === nextPaused) return;
    paused = nextPaused;
    lastFrameTime = 0;
    if (paused && animationFrame !== 0) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    applyAudioGain();
    renderFrame();
    if (!paused) scheduleFrame();
  }

  async function setSoundEnabled(nextEnabled: boolean): Promise<boolean> {
    if (destroyed) return false;
    if (!nextEnabled) {
      soundEnabled = false;
      applyAudioGain();
      return false;
    }

    try {
      if (!audioRig) audioRig = createAudioRig();
      if (audioRig.context.state !== "running") {
        await audioRig.context.resume();
      }
      soundEnabled = audioRig.context.state === "running";
      applyAudioGain();
      updateAudio(performance.now());
      return soundEnabled;
    } catch {
      soundEnabled = false;
      applyAudioGain();
      return false;
    }
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    started = false;
    if (animationFrame !== 0) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    resizeObserver?.disconnect();
    resizeObserver = null;
    soundEnabled = false;
    if (audioRig) {
      const rig = audioRig;
      const now = rig.context.currentTime;
      rig.master.gain.cancelScheduledValues(now);
      rig.master.gain.setTargetAtTime(0.0001, now, 0.025);
      window.setTimeout(() => {
        void rig.context.close().catch(() => undefined);
      }, 90);
      audioRig = null;
    }
    roadPoints.length = 0;
    sceneObjects.length = 0;
    cityLayerItems.length = 0;
    depthSceneItems.length = 0;
    vehicles.length = 0;
    lightTrailPositions.clear();
    noisePattern = null;
    noiseImageData = null;
    skyGradientCache = null;
    horizonHazeCache = null;
    leftHeadlightWashCache = null;
    rightHeadlightWashCache = null;
    roadSheenCache = null;
    distanceFogCache = null;
    vignetteCache = null;
    resizeDrawingLayer(glowLayer, 1, 1);
    resizeDrawingLayer(noiseLayer, 1, 1);
  }

  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", handleVisibilityChange);
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
  }
  resize();

  return {
    start,
    destroy,
    setPaused,
    togglePaused(): boolean {
      setPaused(!paused);
      return paused;
    },
    setSpeedKmh(nextSpeedKmh: number): number {
      if (!Number.isFinite(nextSpeedKmh)) return speedKmh;
      speedKmh = Math.round(clamp(nextSpeedKmh, 30, 180));
      updateAudio(performance.now());
      return speedKmh;
    },
    getSpeedKmh(): number {
      return speedKmh;
    },
    toggleSound(): Promise<boolean> {
      return setSoundEnabled(!soundEnabled);
    },
    setSoundEnabled,
    isSoundEnabled(): boolean {
      return soundEnabled;
    },
  };
}
