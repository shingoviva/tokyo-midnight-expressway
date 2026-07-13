import { createProceduralAssets } from "./procedural-assets";
import { drawProceduralLandmarks } from "./procedural-landmarks";

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

type TrafficVehicle = {
  id: number;
  z: number;
  lane: -1 | 1;
  closingSpeed: number;
  kind: VehicleKind;
  shade: number;
  generation: number;
};

type SceneObject =
  | { kind: "light"; z: number; index: number; side: -1 | 1 }
  | { kind: "sign"; z: number; index: number }
  | { kind: "overpass"; z: number; index: number; level: number }
  | { kind: "bollard"; z: number; index: number; side: -1 | 1 }
  | { kind: "vehicle"; z: number; vehicle: TrafficVehicle };

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
const ROAD_HALF_WIDTH = 4.25;
const FAR_DISTANCE = 1800;
const CITY_FAR_DISTANCE = 2800;
const NEAR_DISTANCE = 4.5;
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

function scenePhase(distance: number): number {
  return positiveModulo(distance, SCENE_LENGTH);
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
  const soundwallPattern = context.createPattern(
    proceduralAssets.surfaces.soundwall,
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
  let roadSliceCount = 104;
  let noisePattern: CanvasPattern | null = null;

  let started = false;
  let destroyed = false;
  let paused = false;
  let hidden = typeof document !== "undefined" ? document.hidden : false;
  let animationFrame = 0;
  let lastFrameTime = 0;
  let lastTelemetryTime = -Infinity;
  let elapsedTime = 0;
  let totalDistanceMeters = 0;
  let speedKmh = 82;
  let smoothedFps = 60;
  let frameNumber = 0;
  let soundEnabled = false;
  let audioRig: AudioRig | null = null;
  let audioUpdateTime = 0;
  let resizeObserver: ResizeObserver | null = null;

  function signGlowColor(family: string, alpha = 0.12): string {
    if (family.startsWith("led")) return `rgba(255, 121, 31, ${alpha * 1.45})`;
    if (family.startsWith("lane-control")) return `rgba(82, 238, 199, ${alpha})`;
    if (family.startsWith("blue")) return `rgba(86, 192, 242, ${alpha})`;
    if (family.includes("magenta")) return `rgba(255, 82, 193, ${alpha})`;
    if (family.startsWith("advertising")) return `rgba(72, 208, 242, ${alpha})`;
    return `rgba(61, 165, 127, ${alpha})`;
  }

  const roadPoints: RoadPoint[] = [];
  const sceneObjects: SceneObject[] = [];
  const vehicles: TrafficVehicle[] = [];
  const lightTrailPositions = new Map<
    number,
    { x: number; y: number; frame: number }
  >();

  const initialVehicleCount = 20;
  for (let index = 0; index < initialVehicleCount; index += 1) {
    const kindRoll = seeded(index, 91);
    vehicles.push({
      id: index,
      z: 42 + index * 52 + seeded(index, 17) * 34,
      lane: seeded(index, 41) > 0.5 ? 1 : -1,
      closingSpeed: 0.55 + seeded(index, 29) * 1.65,
      kind: kindRoll > 0.84 ? "truck" : kindRoll > 0.6 ? "minivan" : "sedan",
      shade: seeded(index, 53),
      generation: 0,
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
    context.imageSmoothingEnabled = true;
    glowLayer.context.imageSmoothingEnabled = true;
  }

  function regenerateNoise(seedOffset: number): void {
    const noiseContext = noiseLayer.context;
    const width = noiseLayer.canvas.width;
    const height = noiseLayer.canvas.height;
    const image = noiseContext.createImageData(width, height);
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
    roadSliceCount = quality === "MOBILE" ? 170 : quality === "BALANCED" ? 240 : 300;
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
    for (let index = 0; index <= roadSliceCount; index += 1) {
      const t = index / roadSliceCount;
      const z =
        NEAR_DISTANCE +
        (FAR_DISTANCE - NEAR_DISTANCE) * Math.pow(t, 1.34);
      const projected = projectedAt(z);
      roadPoints.push({
        z,
        world: totalDistanceMeters + z,
        center: projected.x,
        y: projected.groundY,
        scale: projected.scale,
      });
    }
  }

  function clearGlow(): void {
    const glowContext = glowLayer.context;
    glowContext.save();
    glowContext.setTransform(1, 0, 0, 1, 0, 0);
    glowContext.clearRect(0, 0, glowLayer.canvas.width, glowLayer.canvas.height);
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
    const sky = context.createLinearGradient(0, 0, 0, cssHeight);
    sky.addColorStop(0, "#010509");
    sky.addColorStop(0.42, "#03090e");
    sky.addColorStop(0.7, "#0a1116");
    sky.addColorStop(1, "#11171b");
    context.fillStyle = sky;
    context.fillRect(0, 0, cssWidth, cssHeight);

    const horizonHaze = context.createRadialGradient(
      cssWidth * 0.52,
      horizon,
      0,
      cssWidth * 0.52,
      horizon,
      cssWidth * 0.7,
    );
    horizonHaze.addColorStop(0, "rgba(31, 48, 57, 0.22)");
    horizonHaze.addColorStop(0.45, "rgba(15, 27, 34, 0.09)");
    horizonHaze.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = horizonHaze;
    context.fillRect(0, horizon - cssHeight * 0.22, cssWidth, cssHeight * 0.52);
  }

  function drawBuilding(index: number, side: -1 | 1, z: number): void {
    if (z < 5 || z > CITY_FAR_DISTANCE) return;
    const location = locationIndex(totalDistanceMeters + z);
    const occupancy = seeded(index * 2 + (side > 0 ? 1 : 0), 101);
    const locationDensity = [0.02, 0.08, 0.16, 0.19, 0.13, 0.02, 0.01, 0.04, 0.2, 0.24, 0.31, 0.12, 0.17, 0.06][location];
    if (occupancy < locationDensity + (quality === "MOBILE" ? 0.08 : 0)) return;

    const openWaterfront = location === 8 || location === 9 || location === 10;
    const closeCanyon = location === 0 || location === 5 || location === 6 || location === 7;
    const lateral =
      side *
      (ROAD_HALF_WIDTH +
        (closeCanyon ? 16 : openWaterfront ? 30 : 18) +
        seeded(index, side > 0 ? 113 : 127) *
          (closeCanyon ? 58 : openWaterfront ? 96 : 72));
    const base = projectedAt(z, lateral);
    const widthMeters = 10 + seeded(index, 139 + side) * (closeCanyon ? 34 : 27);
    let heightMeters =
      (openWaterfront ? 10 : 15) +
      seeded(index, 151 - side) * (closeCanyon ? 108 : openWaterfront ? 42 : 72);
    if (seeded(index, 163) > (closeCanyon ? 0.72 : 0.88)) heightMeters += 56;

    const width = widthMeters * base.scale;
    const height = heightMeters * base.scale;
    if (width < 1 || height < 2 || base.x + width < -20 || base.x - width > cssWidth + 20) {
      return;
    }

    const left = base.x - width * 0.5;
    const top = base.groundY - height;
    const bodyLightness = Math.round(8 + seeded(index, 181) * 8);
    const atmosphericAlpha =
      clamp(1.03 - z / 3600, 0.32, 0.96) *
      farFade(z, CITY_FAR_DISTANCE * 0.76, CITY_FAR_DISTANCE) *
      smoothstep(4.5, 18, z);
    context.globalAlpha = atmosphericAlpha;
    const facadeGradient = context.createLinearGradient(left, 0, left + width, 0);
    facadeGradient.addColorStop(0, `rgb(${Math.max(2, bodyLightness - 5)}, ${bodyLightness}, ${bodyLightness + 3})`);
    facadeGradient.addColorStop(0.48, `rgb(${bodyLightness + 2}, ${bodyLightness + 7}, ${bodyLightness + 11})`);
    facadeGradient.addColorStop(1, `rgb(${Math.max(2, bodyLightness - 4)}, ${bodyLightness}, ${bodyLightness + 5})`);
    context.fillStyle = facadeGradient;
    context.fillRect(left, top, width, height + 2);
    if (concretePattern && z < 900) {
      context.save();
      context.globalAlpha = atmosphericAlpha * 0.16 * farFade(z, 620, 930);
      context.fillStyle = concretePattern;
      context.fillRect(left, top, width, height + 2);
      context.restore();
    }

    const depth = width * (0.12 + seeded(index, 193) * 0.12);
    context.fillStyle = side > 0 ? "#05090d" : "#0d1216";
    fillPolygon(context, [
      [side > 0 ? left : left + width, top],
      [side > 0 ? left - depth : left + width + depth, top + depth * 0.22],
      [side > 0 ? left - depth : left + width + depth, base.groundY],
      [side > 0 ? left : left + width, base.groundY],
    ]);

    const roofAccent = seeded(index, 211);
    if (roofAccent > 0.58 && width > 7) {
      context.strokeStyle = roofAccent > 0.83
        ? "rgba(159, 188, 199, 0.5)"
        : "rgba(88, 105, 115, 0.38)";
      context.lineWidth = clamp(base.scale * 0.18, 0.5, 2.2);
      context.beginPath();
      context.moveTo(left, top + 1);
      context.lineTo(left + width, top + 1);
      context.stroke();
    }

    if (height > 3 && width > 2) {
      const realRows = Math.max(3, Math.floor(heightMeters / 3.35));
      const realColumns = Math.max(2, Math.floor(widthMeters / 3.1));
      const maximumRows = quality === "MOBILE"
        ? 12
        : z > 1350
          ? 6
          : z > 760
            ? 13
            : 30;
      const rowStep = Math.max(1, Math.ceil(realRows / maximumRows));
      const maximumColumns = z > 1350 ? 3 : z > 760 ? 5 : 9;
      const columnStep = Math.max(1, Math.ceil(realColumns / maximumColumns));
      const windowWidth = clamp(base.scale * 2.05, 0.65, width * 0.18);
      const windowHeight = clamp(base.scale * 1.08, 0.55, 4.2);
      context.globalAlpha = atmosphericAlpha * farFade(z, 1420, 2140);

      if (z < 720 && width > 16) {
        context.save();
        context.globalAlpha *= 0.34 * farFade(z, 470, 720);
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
              warm ? "rgba(255, 188, 105, 0.19)" : "rgba(143, 211, 239, 0.16)",
            );
          }
        }
      }
      context.globalAlpha = atmosphericAlpha;
    }

    if (
      advertisingSigns.length > 0 &&
      seeded(index, 271) > (location === 5 || location === 13 ? 0.76 : 0.93) &&
      width > 16 &&
      height > 25
    ) {
      const sign = advertisingSigns[
        positiveModulo(index, advertisingSigns.length)
      ];
      const boardWidth = width * 0.74;
      const boardHeight = boardWidth * (sign.heightMeters / sign.widthMeters);
      const boardX = left + width * 0.16;
      const boardY = top + height * 0.22;
      context.drawImage(sign.canvas, boardX, boardY, boardWidth, boardHeight);
      drawGlowDot(
        boardX + boardWidth * 0.5,
        boardY + boardHeight * 0.5,
        boardWidth * 0.55,
        signGlowColor(sign.family, 0.1),
      );
    }

    if (heightMeters > 65 && width > 3) {
      const beaconX = left + width * (0.28 + seeded(index, 283) * 0.44);
      const beaconY = top - 1;
      context.fillStyle = "rgba(223, 37, 34, 0.9)";
      context.fillRect(beaconX - 1, beaconY - 1, 2, 2);
      drawGlowDot(beaconX, beaconY, clamp(base.scale * 1.4, 3, 13), "rgba(255, 30, 24, 0.34)");
    }
    context.globalAlpha = 1;
  }

  function drawCity(): void {
    const spacing = quality === "MOBILE" ? 48 : quality === "BALANCED" ? 38 : 32;
    const first = Math.floor((totalDistanceMeters - spacing) / spacing);
    const last = Math.ceil((totalDistanceMeters + CITY_FAR_DISTANCE + 90) / spacing);
    for (let index = last; index >= first; index -= 1) {
      const world = index * spacing + (seeded(index, 307) - 0.5) * spacing * 0.58;
      const z = world - totalDistanceMeters;
      drawBuilding(index, -1, z);
      drawBuilding(index, 1, z + (seeded(index, 311) - 0.5) * 14);
    }
  }

  function drawRoadBase(): void {
    for (let index = roadPoints.length - 1; index >= 1; index -= 1) {
      const far = roadPoints[index];
      const near = roadPoints[index - 1];
      const farOuter = (ROAD_HALF_WIDTH + 1.18) * far.scale;
      const nearOuter = (ROAD_HALF_WIDTH + 1.18) * near.scale;
      context.fillStyle = index % 2 === 0 ? "#22282b" : "#202629";
      fillPolygon(context, [
        [far.center - farOuter, far.y],
        [far.center + farOuter, far.y],
        [near.center + nearOuter, near.y + 0.7],
        [near.center - nearOuter, near.y + 0.7],
      ]);

    }
    for (let index = roadPoints.length - 1; index >= 1; index -= 1) {
      const far = roadPoints[index];
      const near = roadPoints[index - 1];
      const farRoad = ROAD_HALF_WIDTH * far.scale;
      const nearRoad = ROAD_HALF_WIDTH * near.scale;
      const asphaltBand = hashInteger(Math.floor((far.world + near.world) * 0.065)) & 3;
      context.fillStyle = asphaltBand === 0
        ? "#171b1e"
        : asphaltBand === 1
          ? "#191d20"
          : "#181c1f";
      fillPolygon(context, [
        [far.center - farRoad, far.y],
        [far.center + farRoad, far.y],
        [near.center + nearRoad, near.y + 0.8],
        [near.center - nearRoad, near.y + 0.8],
      ]);

      if (asphaltPattern && far.z < 980) {
        context.save();
        context.globalAlpha = 0.055 + farFade(far.z, 380, 980) * 0.17;
        context.fillStyle = asphaltPattern;
        fillPolygon(context, [
          [far.center - farRoad, far.y],
          [far.center + farRoad, far.y],
          [near.center + nearRoad, near.y + 0.8],
          [near.center - nearRoad, near.y + 0.8],
        ]);
        context.restore();
      }

      const seamHash = hashInteger(Math.floor(far.world / 19));
      if ((seamHash & 7) === 0 && far.z < 520) {
        context.strokeStyle = "rgba(4, 7, 9, 0.17)";
        context.lineWidth = clamp(near.scale * 0.035, 0.4, 2.2);
        context.beginPath();
        context.moveTo(near.center - nearRoad * 0.94, near.y);
        context.lineTo(near.center + nearRoad * 0.94, near.y);
        context.stroke();
      }
    }

    context.save();
    context.globalAlpha = 0.14;
    context.strokeStyle = "rgba(4, 7, 8, 0.42)";
    for (const lateral of [-2.05, 2.05]) {
      context.lineWidth = clamp(cssWidth * 0.0022, 1, 3.2);
      context.beginPath();
      let startedTrack = false;
      for (let index = roadPoints.length - 1; index >= 0; index -= 1) {
        const point = roadPoints[index];
        if (point.z > 620) continue;
        const x = point.center + lateral * point.scale;
        if (!startedTrack) {
          context.moveTo(x, point.y);
          startedTrack = true;
        } else {
          context.lineTo(x, point.y);
        }
      }
      context.stroke();
    }
    context.restore();

    const roadWash = context.createRadialGradient(
      cssWidth * 0.5,
      cssHeight * 1.07,
      0,
      cssWidth * 0.5,
      cssHeight * 1.02,
      cssHeight * 0.78,
    );
    roadWash.addColorStop(0, "rgba(131, 160, 170, 0.13)");
    roadWash.addColorStop(0.46, "rgba(76, 102, 113, 0.055)");
    roadWash.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = roadWash;
    context.fillRect(0, horizon, cssWidth, cssHeight - horizon);
  }

  function drawRoadQuad(
    zNear: number,
    zFar: number,
    lateralNear: number,
    lateralFar: number,
    widthMeters: number,
    color: string,
  ): void {
    if (zFar <= NEAR_DISTANCE || zNear >= FAR_DISTANCE) return;
    const near = projectedAt(Math.max(NEAR_DISTANCE, zNear));
    const far = projectedAt(Math.min(FAR_DISTANCE, zFar));
    const halfNear = widthMeters * near.scale * 0.5;
    const halfFar = widthMeters * far.scale * 0.5;
    context.fillStyle = color;
    fillPolygon(context, [
      [far.x + lateralFar * far.scale - halfFar, far.groundY],
      [far.x + lateralFar * far.scale + halfFar, far.groundY],
      [near.x + lateralNear * near.scale + halfNear, near.groundY + 0.7],
      [near.x + lateralNear * near.scale - halfNear, near.groundY + 0.7],
    ]);
  }

  function drawContinuousRoadLine(
    lateral: number,
    widthMeters: number,
    color: string,
  ): void {
    context.fillStyle = color;
    for (let index = roadPoints.length - 1; index >= 1; index -= 1) {
      const far = roadPoints[index];
      const near = roadPoints[index - 1];
      const farHalf = widthMeters * far.scale * 0.5;
      const nearHalf = widthMeters * near.scale * 0.5;
      const farX = far.center + lateral * far.scale;
      const nearX = near.center + lateral * near.scale;
      fillPolygon(context, [
        [farX - farHalf, far.y],
        [farX + farHalf, far.y],
        [nearX + nearHalf, near.y + 0.8],
        [nearX - nearHalf, near.y + 0.8],
      ]);
    }
  }

  function drawRoadMarkings(): void {
    const phase = scenePhase(totalDistanceMeters);
    drawContinuousRoadLine(
      -ROAD_HALF_WIDTH + 0.18,
      0.12,
      phase > 4800 && phase < 6900 ? "rgba(224, 184, 63, 0.9)" : "rgba(224, 228, 226, 0.87)",
    );
    drawContinuousRoadLine(
      ROAD_HALF_WIDTH - 0.18,
      0.12,
      "rgba(225, 228, 226, 0.88)",
    );

    const dashPeriod = 12;
    let dashWorld = Math.floor((totalDistanceMeters + FAR_DISTANCE) / dashPeriod) * dashPeriod;
    for (; dashWorld > totalDistanceMeters + NEAR_DISTANCE - dashPeriod; dashWorld -= dashPeriod) {
      const zNear = dashWorld - totalDistanceMeters;
      drawRoadQuad(
        zNear,
        zNear + 5.4,
        0,
        0,
        0.13,
        "rgba(223, 226, 224, 0.9)",
      );
    }

    const blockStart = Math.floor((totalDistanceMeters - 6120) / SCENE_LENGTH) - 1;
    for (let block = blockStart; block <= blockStart + 3; block += 1) {
      const zebraStart = block * SCENE_LENGTH + 6120;
      for (let stripe = 0; stripe < 22; stripe += 1) {
        const world = zebraStart + stripe * 5.1;
        const z = world - totalDistanceMeters;
        if (z < NEAR_DISTANCE - 8 || z > FAR_DISTANCE) continue;
        drawRoadQuad(
          z,
          z + 1.9,
          1.15,
          3.75,
          0.32,
          "rgba(225, 228, 226, 0.72)",
        );
      }
    }

    const arrowPeriod = 430;
    let arrowWorld = Math.floor((totalDistanceMeters + FAR_DISTANCE) / arrowPeriod) * arrowPeriod + 70;
    for (; arrowWorld > totalDistanceMeters + 18; arrowWorld -= arrowPeriod) {
      const z = arrowWorld - totalDistanceMeters;
      if (z > FAR_DISTANCE) continue;
      const lane = seeded(Math.floor(arrowWorld / arrowPeriod), 347) > 0.5 ? 1.95 : -1.95;
      const points = [
        { z: z + 9.5, lateral: lane },
        { z: z + 5.8, lateral: lane - 0.55 },
        { z: z + 6.2, lateral: lane - 0.17 },
        { z, lateral: lane - 0.17 },
        { z, lateral: lane + 0.17 },
        { z: z + 6.2, lateral: lane + 0.17 },
        { z: z + 5.8, lateral: lane + 0.55 },
      ];
      context.fillStyle = "rgba(220, 224, 222, 0.65)";
      fillPolygon(
        context,
        points.map((point) => {
          const projected = projectedAt(point.z, point.lateral);
          return [projected.x, projected.groundY] as const;
        }),
      );
    }
  }

  function elevatedOffset(world: number, level: number): number {
    const location = locationIndex(world);
    const local = locationLocal(world) / LOCATION_LENGTH;
    if (location === 1) {
      return level === 0
        ? Math.cos(local * Math.PI) * 21
        : -29 + Math.sin(local * TAU) * 7;
    }
    if (location === 12) {
      return (level === 0 ? 24 : -31) + Math.sin(local * Math.PI * 1.45) * 9;
    }
    return 29 + Math.sin(local * TAU) * 4;
  }

  function drawElevatedDecks(): void {
    for (let level = quality === "MOBILE" ? 0 : 1; level >= 0; level -= 1) {
      const heightMeters = level === 0 ? 8.6 : 14.2;
      const halfWidth = level === 0 ? 4.7 : 4.25;
      for (let index = roadPoints.length - 1; index >= 1; index -= 1) {
        const far = roadPoints[index];
        const near = roadPoints[index - 1];
        const farLocation = locationIndex(far.world);
        const nearLocation = locationIndex(near.world);
        const phaseInRange = (world: number, location: number) => {
          const local = locationLocal(world);
          if (location === 1) return level === 0 || (local > 90 && local < 610);
          if (location === 12) return level === 0 || (local > 165 && local < 545);
          return location === 9 && level === 0 && local > 80 && local < 650;
        };
        if (!phaseInRange(far.world, farLocation) || !phaseInRange(near.world, nearLocation)) continue;

        const farOffset = elevatedOffset(far.world, level);
        const nearOffset = elevatedOffset(near.world, level);
        const farY = far.y - heightMeters * far.scale;
        const nearY = near.y - heightMeters * near.scale;
        const farCenter = far.center + farOffset * far.scale;
        const nearCenter = near.center + nearOffset * near.scale;
        const farHalf = halfWidth * far.scale;
        const nearHalf = halfWidth * near.scale;
        const thicknessFar = 1.1 * far.scale;
        const thicknessNear = 1.1 * near.scale;

        context.fillStyle = level === 0 ? "#30383c" : "#242b2f";
        fillPolygon(context, [
          [farCenter - farHalf, farY],
          [farCenter + farHalf, farY],
          [nearCenter + nearHalf, nearY],
          [nearCenter - nearHalf, nearY],
        ]);
        if (metalPattern && near.z < 880) {
          context.save();
          context.globalAlpha = 0.11 * farFade(near.z, 540, 880);
          context.fillStyle = metalPattern;
          fillPolygon(context, [
            [farCenter - farHalf, farY],
            [farCenter + farHalf, farY],
            [nearCenter + nearHalf, nearY],
            [nearCenter - nearHalf, nearY],
          ]);
          context.restore();
        }
        context.fillStyle = level === 0 ? "#141a1e" : "#10161a";
        fillPolygon(context, [
          [farCenter - farHalf, farY],
          [farCenter + farHalf, farY],
          [farCenter + farHalf, farY + thicknessFar],
          [nearCenter + nearHalf, nearY + thicknessNear],
          [nearCenter - nearHalf, nearY + thicknessNear],
          [farCenter - farHalf, farY + thicknessFar],
        ]);
        context.strokeStyle = "rgba(122, 139, 146, 0.42)";
        context.lineWidth = clamp(near.scale * 0.1, 0.45, 2.4);
        context.beginPath();
        context.moveTo(farCenter + farHalf, farY);
        context.lineTo(nearCenter + nearHalf, nearY);
        context.stroke();
      }
    }
  }

  function collectSceneObjects(): void {
    sceneObjects.length = 0;

    const lightFirst = Math.floor((totalDistanceMeters - LIGHT_SPACING) / LIGHT_SPACING);
    const lightLast = Math.ceil((totalDistanceMeters + FAR_DISTANCE) / LIGHT_SPACING);
    for (let index = lightFirst; index <= lightLast; index += 1) {
      const world = index * LIGHT_SPACING;
      const z = world - totalDistanceMeters;
      if (z < 0.72 || z > FAR_DISTANCE) continue;
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
      if (z > 0.82 && z < FAR_DISTANCE) {
        sceneObjects.push({ kind: "sign", z, index });
      }
    }

    const firstBlock = Math.floor((totalDistanceMeters - SCENE_LENGTH) / SCENE_LENGTH);
    for (let block = firstBlock; block <= firstBlock + 2; block += 1) {
      const anchors = [865, 1120, 2485, 4580, 6480, 8565, 8840];
      for (let level = 0; level < anchors.length; level += 1) {
        const world = block * SCENE_LENGTH + anchors[level];
        const z = world - totalDistanceMeters;
        if (z > 1.1 && z < FAR_DISTANCE) {
          sceneObjects.push({
            kind: "overpass",
            z,
            index: block * anchors.length + level,
            level: level % 3,
          });
        }
      }
    }

    const activeVehicleCount = quality === "MOBILE" ? 12 : vehicles.length;
    for (let index = 0; index < activeVehicleCount; index += 1) {
      const vehicle = vehicles[index];
      if (vehicle.z > 0.72 && vehicle.z < FAR_DISTANCE) {
        sceneObjects.push({ kind: "vehicle", z: vehicle.z, vehicle });
      }
    }

    const bollardSpacing = 9.4;
    const bollardFirst = Math.floor((totalDistanceMeters - bollardSpacing) / bollardSpacing);
    const bollardLast = Math.ceil((totalDistanceMeters + FAR_DISTANCE) / bollardSpacing);
    for (let index = bollardFirst; index <= bollardLast; index += 1) {
      const world = index * bollardSpacing;
      if (locationIndex(world) !== 11) continue;
      const local = locationLocal(world);
      if (local < 65 || local > 645) continue;
      const z = world - totalDistanceMeters;
      if (z <= 0.82 || z >= FAR_DISTANCE) continue;
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

    if (base.x < -80 || base.x > cssWidth + 80 || top.y > cssHeight + 20) return;
    const visibility = farFade(object.z, FAR_DISTANCE * 0.7, FAR_DISTANCE);
    if (visibility <= 0.002) return;
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
        const trailLength = Math.min(5, distance);
        const ratio = trailLength / distance;
        const glowContext = glowLayer.context;
        glowContext.save();
        glowContext.globalAlpha = 0.1 * visibility;
        glowContext.strokeStyle = cool ? "rgba(155, 224, 250, 0.72)" : "rgba(255, 156, 78, 0.7)";
        glowContext.lineWidth = Math.max(0.8, lampRadius * 1.08);
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
        ? `rgba(141, 215, 247, ${0.48 * visibility})`
        : `rgba(255, 143, 65, ${0.5 * visibility})`,
    );
    context.restore();
  }

  function drawOverpass(object: Extract<SceneObject, { kind: "overpass" }>): void {
    const base = projectedAt(object.z);
    const world = totalDistanceMeters + object.z;
    const location = locationIndex(world);
    const local = locationLocal(world);
    const visibility =
      farFade(object.z, FAR_DISTANCE * 0.72, FAR_DISTANCE) *
      smoothstep(0.85, 5.5, object.z);
    if (visibility <= 0.002) return;

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
        if (concretePattern && object.z < 820) {
          context.globalAlpha = visibility * 0.18;
          context.strokeStyle = concretePattern;
          context.stroke();
        }
        const lampY = base.groundY - portalHeight * 0.72;
        for (const offset of [-2.25, 0, 2.25]) {
          const lampX = base.x + offset * base.scale;
          context.fillStyle = "#e1f5f5";
          context.fillRect(lampX - 1.3, lampY - 0.7, 2.6, 1.4);
          drawGlowDot(lampX, lampY, clamp(base.scale * 1.25, 4, 34), "rgba(133, 218, 236, 0.28)");
        }
        context.restore();
      }
      return;
    }

    const height = 7.5 + object.level * 1.15;
    const deckY = base.groundY - height * base.scale;
    const deckHalfWidth = 47 * base.scale;
    const thickness = clamp(1.35 * base.scale, 2, cssHeight * 0.18);
    if (deckY > cssHeight + thickness || deckY < -cssHeight * 0.4) return;

    const fogAlpha = clamp(1.2 - object.z / 1800, 0.32, 1) * visibility;
    context.save();
    context.globalAlpha = fogAlpha;
    const deckGradient = context.createLinearGradient(0, deckY, 0, deckY + thickness);
    deckGradient.addColorStop(0, object.level === 1 ? "#465157" : "#3a4449");
    deckGradient.addColorStop(0.28, "#252d31");
    deckGradient.addColorStop(1, "#10161a");
    context.fillStyle = deckGradient;
    context.fillRect(base.x - deckHalfWidth, deckY, deckHalfWidth * 2, thickness);
    if (metalPattern && object.z < 920) {
      context.globalAlpha = fogAlpha * 0.16 * farFade(object.z, 560, 920);
      context.fillStyle = metalPattern;
      context.fillRect(base.x - deckHalfWidth, deckY, deckHalfWidth * 2, thickness);
      context.globalAlpha = fogAlpha;
    }

    context.fillStyle = "rgba(86, 99, 105, 0.86)";
    const pierWidth = clamp(base.scale * 2.7, 2, cssWidth * 0.2);
    for (const lateral of [-13, 13]) {
      const pierX = base.x + lateral * base.scale;
      context.fillRect(
        pierX - pierWidth * 0.5,
        deckY + thickness * 0.68,
        pierWidth,
        Math.max(0, base.groundY - deckY - thickness * 0.68),
      );
    }

    context.strokeStyle = "rgba(121, 137, 144, 0.42)";
    context.lineWidth = clamp(base.scale * 0.18, 0.5, 3);
    const ribSpacing = Math.max(7, base.scale * 3.8);
    for (let x = base.x - deckHalfWidth; x < base.x + deckHalfWidth; x += ribSpacing) {
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
      drawGlowDot(x, y, clamp(base.scale * 1.5, 5, 30), "rgba(131, 211, 238, 0.28)");
    }
    context.restore();
  }

  function drawSign(object: Extract<SceneObject, { kind: "sign" }>): void {
    if (roadSigns.length === 0) return;
    const sign = roadSigns[positiveModulo(object.index, roadSigns.length)];
    const roadside = sign.family.startsWith("blue") && positiveModulo(object.index, 3) === 1;
    const lateral = roadside ? (object.index % 2 === 0 ? -5.6 : 5.6) : 0;
    const base = projectedAt(object.z, lateral);
    const boardBottomMeters = roadside ? 4.25 : 6.35;
    const boardWidth = sign.widthMeters * base.scale;
    const boardHeight = sign.heightMeters * base.scale;
    const signCenterY =
      base.groundY - (boardBottomMeters + sign.heightMeters * 0.5) * base.scale;
    if (
      boardWidth < 0.35 ||
      signCenterY + boardHeight < -20 ||
      signCenterY - boardHeight > cssHeight + 20 ||
      base.x + boardWidth < -40 ||
      base.x - boardWidth > cssWidth + 40
    ) {
      return;
    }

    const boardX = base.x - boardWidth * 0.5;
    const boardY = signCenterY - boardHeight * 0.5;
    const visibility =
      farFade(object.z, FAR_DISTANCE * 0.66, FAR_DISTANCE) *
      smoothstep(0.82, 3.4, object.z);
    if (visibility <= 0.002) return;

    context.save();
    context.globalAlpha = visibility;
    const poleWidth = clamp(base.scale * 0.16, 0.5, 4);
    context.strokeStyle = "rgba(118, 132, 135, 0.76)";
    context.lineWidth = poleWidth;
    context.beginPath();
    const supportSpread = roadside ? 0 : boardWidth * 0.43;
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

    context.drawImage(sign.canvas, boardX, boardY, boardWidth, boardHeight);
    context.strokeStyle = "rgba(221, 232, 225, 0.46)";
    context.lineWidth = clamp(base.scale * 0.055, 0.35, 1.8);
    context.strokeRect(boardX, boardY, boardWidth, boardHeight);
    glowLayer.context.save();
    glowLayer.context.globalAlpha = visibility;
    drawGlowDot(
      base.x,
      signCenterY,
      clamp(boardWidth * 0.62, 8, 72),
      signGlowColor(sign.family, 0.11),
    );
    glowLayer.context.restore();
    context.restore();
  }

  function vehiclePaint(shade: number): { body: string; highlight: string } {
    if (shade < 0.22) return { body: "#181b1e", highlight: "#3a4044" };
    if (shade < 0.46) return { body: "#747a7d", highlight: "#aab0b1" };
    if (shade < 0.72) return { body: "#d0d1cc", highlight: "#f0eee7" };
    if (shade < 0.88) return { body: "#2b3440", highlight: "#596677" };
    return { body: "#6b2220", highlight: "#9a4a43" };
  }

  function drawVehicle(object: Extract<SceneObject, { kind: "vehicle" }>): void {
    const vehicle = object.vehicle;
    const laneCenter = vehicle.lane * 2.08;
    const base = projectedAt(object.z, laneCenter);
    const dimensions = vehicle.kind === "truck"
      ? { width: 2.42, height: 3.45 }
      : vehicle.kind === "minivan"
        ? { width: 1.9, height: 1.72 }
        : { width: 1.82, height: 1.35 };
    const width = dimensions.width * base.scale;
    const height = dimensions.height * base.scale;
    if (base.x + width < -12 || base.x - width > cssWidth + 12) return;
    const visibility =
      farFade(object.z, FAR_DISTANCE * 0.63, FAR_DISTANCE * 0.96) *
      smoothstep(0.72, 2.8, object.z);
    if (visibility <= 0.002) return;

    if (width < 1.25) {
      context.save();
      context.globalAlpha = visibility;
      for (const side of [-1, 1]) {
        const tailX = base.x + side * Math.max(0.55, width * 0.34);
        context.fillStyle = "rgba(255, 56, 42, 0.92)";
        context.fillRect(tailX - 0.55, base.groundY - 1.2, 1.1, 1.1);
        drawGlowDot(
          tailX,
          base.groundY - 0.6,
          3.2,
          `rgba(255, 35, 24, ${0.42 * visibility})`,
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
    const paint = vehiclePaint(vehicle.shade);

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
      fillPolygon(context, [
        [left, bottom],
        [left + width * 0.06, top + height * 0.38],
        [left + width * 0.23, top + height * 0.08],
        [left + width * 0.77, top + height * 0.08],
        [left + width * 0.94, top + height * 0.38],
        [left + width, bottom],
      ]);
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

    const tailY = vehicle.kind === "truck" ? bottom - height * 0.13 : bottom - height * 0.22;
    const tailOffset = width * 0.34;
    const tailWidth = clamp(width * 0.12, 1, 15);
    const tailHeight = clamp(height * 0.075, 1, 8);
    for (const side of [-1, 1]) {
      const tailX = base.x + side * tailOffset;
      context.fillStyle = "#f13b2f";
      context.fillRect(tailX - tailWidth * 0.5, tailY, tailWidth, tailHeight);
      drawGlowDot(
        tailX,
        tailY + tailHeight * 0.5,
        clamp(base.scale * 1.25, 3, 26),
        `rgba(255, 34, 22, ${0.5 * visibility})`,
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
    const visibility = farFade(object.z, 900, FAR_DISTANCE) * smoothstep(0.35, 1.5, height);
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
    else if (object.kind === "bollard") drawBollard(object);
    else drawVehicle(object);
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
    const projectedHeight = wallHeight * near.scale;
    const visibility =
      alpha *
      smoothstep(0.16, 0.72, projectedHeight) *
      farFade(near.z, FAR_DISTANCE * 0.82, FAR_DISTANCE);
    if (visibility <= 0.002) return;

    context.save();
    context.globalAlpha = visibility;
    context.fillStyle = color;
    fillPolygon(context, [
      [farX, far.y],
      [farX, farTop],
      [nearX, nearTop],
      [nearX, near.y + 0.28],
    ]);
    if (texture && near.z < 920) {
      context.globalAlpha = visibility * (0.1 + farFade(near.z, 520, 920) * 0.17);
      context.fillStyle = texture;
      fillPolygon(context, [
        [farX, far.y],
        [farX, farTop],
        [nearX, nearTop],
        [nearX, near.y + 0.28],
      ]);
    }
    context.strokeStyle = "rgba(204, 216, 218, 0.58)";
    context.lineWidth = clamp(near.scale * 0.065, 0.42, 2.2);
    context.beginPath();
    context.moveTo(farX, farTop);
    context.lineTo(nearX, nearTop);
    context.stroke();
    context.restore();
  }

  function drawBarrierSlice(far: RoadPoint, near: RoadPoint, sliceIndex: number): void {
    const world = (far.world + near.world) * 0.5;
    const location = locationIndex(world);
    const alternating = (Math.floor(world / 9.6) & 1) === 0;
    const chevrons = location === 11 || (location === 0 && locationLocal(world) > 510);
    const soundwall = location === 2 || location === 12;
    const baseTexture = concretePattern;

    for (const side of [-1, 1] as const) {
      const height = side < 0 ? 0.9 : 0.84;
      const baseColor = chevrons
        ? alternating ? "#b9bfbd" : "#adb4b2"
        : side < 0
          ? alternating ? "#596163" : "#4e5658"
          : alternating ? "#60686a" : "#555e60";
      drawBarrierSegment(far, near, side, height, baseColor, baseTexture, 1);

      if (Math.floor(far.world / 6.8) !== Math.floor(near.world / 6.8) && near.z < 720) {
        const lateral = side * (ROAD_HALF_WIDTH + 0.72);
        const base = projectedAt(near.z, lateral);
        const top = projectedAt(near.z, lateral, height);
        const detailVisibility = farFade(near.z, 440, 720);
        context.save();
        context.globalAlpha = 0.42 * detailVisibility;
        context.strokeStyle = "rgba(28, 39, 43, 0.9)";
        context.lineWidth = clamp(near.scale * 0.035, 0.35, 1.15);
        context.beginPath();
        context.moveTo(base.x, base.groundY);
        context.lineTo(top.x, top.y);
        context.stroke();
        if (near.z < 260) {
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

      if (chevrons && near.scale * height > 1.05) {
        const lateral = side * (ROAD_HALF_WIDTH + 0.72);
        const farX = far.center + lateral * far.scale;
        const nearX = near.center + lateral * near.scale;
        const farTop = far.y - height * far.scale;
        const nearTop = near.y - height * near.scale;
        context.save();
        context.globalAlpha = farFade(near.z, 860, FAR_DISTANCE);
        context.fillStyle = "rgba(188, 41, 31, 0.94)";
        const reverse = ((sliceIndex + (side > 0 ? 1 : 0)) & 1) === 0;
        fillPolygon(context, reverse ? [
          [farX, lerp(farTop, far.y, 0.08)],
          [nearX, lerp(nearTop, near.y, 0.47)],
          [nearX, lerp(nearTop, near.y, 0.92)],
          [farX, lerp(farTop, far.y, 0.53)],
        ] : [
          [farX, lerp(farTop, far.y, 0.47)],
          [nearX, lerp(nearTop, near.y, 0.08)],
          [nearX, lerp(nearTop, near.y, 0.53)],
          [farX, lerp(farTop, far.y, 0.92)],
        ]);
        context.restore();
      }

      if (soundwall && (side < 0 || locationLocal(world) < 430)) {
        const wallHeight = side < 0 ? 3.55 : 3.05;
        drawBarrierSegment(
          far,
          near,
          side,
          wallHeight,
          "rgba(67, 82, 90, 0.9)",
          soundwallPattern,
          0.88,
        );
        if (Math.floor(far.world / 8.4) !== Math.floor(near.world / 8.4) && near.z < 760) {
          const lateral = side * (ROAD_HALF_WIDTH + 0.72);
          const base = projectedAt(near.z, lateral);
          const top = projectedAt(near.z, lateral, wallHeight);
          context.strokeStyle = "rgba(139, 155, 162, 0.7)";
          context.lineWidth = clamp(near.scale * 0.105, 0.45, 3);
          context.beginPath();
          context.moveTo(base.x, base.groundY);
          context.lineTo(top.x, top.y);
          context.stroke();
        }
      }
    }
  }

  function drawDepthScene(): void {
    let objectIndex = 0;
    for (let index = roadPoints.length - 1; index >= 1; index -= 1) {
      const far = roadPoints[index];
      const near = roadPoints[index - 1];

      while (objectIndex < sceneObjects.length && sceneObjects[objectIndex].z > far.z) {
        drawSceneObject(sceneObjects[objectIndex]);
        objectIndex += 1;
      }

      drawBarrierSlice(far, near, index);

      while (objectIndex < sceneObjects.length && sceneObjects[objectIndex].z > near.z) {
        drawSceneObject(sceneObjects[objectIndex]);
        objectIndex += 1;
      }
    }

    while (objectIndex < sceneObjects.length) {
      drawSceneObject(sceneObjects[objectIndex]);
      objectIndex += 1;
    }

    for (const [key, trail] of lightTrailPositions) {
      if (frameNumber - trail.frame > 3) lightTrailPositions.delete(key);
    }
  }

  function drawHeadlightReflections(): void {
    context.save();
    context.globalCompositeOperation = "screen";
    const leftWash = context.createRadialGradient(
      cssWidth * 0.12,
      cssHeight * 0.82,
      0,
      cssWidth * 0.12,
      cssHeight * 0.82,
      cssHeight * 0.48,
    );
    leftWash.addColorStop(0, "rgba(128, 201, 230, 0.2)");
    leftWash.addColorStop(0.38, "rgba(88, 151, 181, 0.07)");
    leftWash.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = leftWash;
    context.fillRect(0, horizon, cssWidth * 0.55, cssHeight - horizon);

    const rightWash = context.createRadialGradient(
      cssWidth * 0.88,
      cssHeight * 0.86,
      0,
      cssWidth * 0.88,
      cssHeight * 0.86,
      cssHeight * 0.45,
    );
    rightWash.addColorStop(0, "rgba(103, 172, 203, 0.12)");
    rightWash.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = rightWash;
    context.fillRect(cssWidth * 0.45, horizon, cssWidth * 0.55, cssHeight - horizon);

    const roadSheen = context.createLinearGradient(0, horizon, 0, cssHeight);
    roadSheen.addColorStop(0, "rgba(93, 133, 149, 0)");
    roadSheen.addColorStop(0.58, "rgba(93, 133, 149, 0.02)");
    roadSheen.addColorStop(1, "rgba(132, 184, 201, 0.085)");
    context.fillStyle = roadSheen;
    context.fillRect(cssWidth * 0.18, horizon, cssWidth * 0.64, cssHeight - horizon);
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
    const distanceFog = context.createLinearGradient(
      0,
      horizon - cssHeight * 0.09,
      0,
      horizon + cssHeight * 0.21,
    );
    distanceFog.addColorStop(0, "rgba(18, 29, 35, 0)");
    distanceFog.addColorStop(0.48, "rgba(23, 36, 42, 0.105)");
    distanceFog.addColorStop(1, "rgba(15, 22, 27, 0)");
    context.fillStyle = distanceFog;
    context.fillRect(0, horizon - cssHeight * 0.1, cssWidth, cssHeight * 0.34);

    const vignette = context.createRadialGradient(
      cssWidth * 0.5,
      cssHeight * 0.5,
      Math.min(cssWidth, cssHeight) * 0.22,
      cssWidth * 0.5,
      cssHeight * 0.49,
      Math.max(cssWidth, cssHeight) * 0.72,
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.66, "rgba(0, 0, 0, 0.08)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.58)");
    context.fillStyle = vignette;
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
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    clearGlow();
    drawSky();
    buildRoadPoints();
    drawCity();
    drawProceduralLandmarks(context, glowLayer.context, {
      totalDistanceMeters,
      sceneLength: SCENE_LENGTH,
      cssWidth,
      cssHeight,
      quality,
      project: (z, lateral, objectHeight) =>
        projectedAt(z, lateral, objectHeight),
      glowDot: drawGlowDot,
    });
    drawElevatedDecks();
    drawRoadBase();
    drawRoadMarkings();
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
    vehicle.z = farthestVehicle + 58 + seeded(seed, 367) * 170;
    vehicle.lane = seeded(seed, 373) > 0.5 ? 1 : -1;
    vehicle.closingSpeed = 0.5 + seeded(seed, 379) * 2.2;
    const kindRoll = seeded(seed, 383);
    vehicle.kind = kindRoll > 0.87 ? "truck" : kindRoll > 0.62 ? "minivan" : "sedan";
    vehicle.shade = seeded(seed, 389);
  }

  function updateVehicles(deltaSeconds: number): void {
    const paceFactor = 0.7 + speedKmh / 165;
    for (const vehicle of vehicles) {
      vehicle.z -= vehicle.closingSpeed * paceFactor * deltaSeconds;
      if (vehicle.z < -16) recycleVehicle(vehicle);
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
      distanceKm: Math.round((totalDistanceMeters / 1000) * 100) / 100,
      routeName: route.routeName,
      sceneName: route.sceneName,
      fps: Math.round(smoothedFps),
      quality,
    });
  }

  function audioTargetGain(): number {
    if (!soundEnabled || paused || hidden) return 0.0001;
    return 0.046;
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
    audioRig.roadGain.gain.setTargetAtTime(0.23 + normalizedSpeed * 0.31, now, 0.15);
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
    totalDistanceMeters += (speedKmh / 3.6) * deltaSeconds;
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
