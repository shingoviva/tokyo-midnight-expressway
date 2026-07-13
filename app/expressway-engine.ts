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
const FAR_DISTANCE = 1180;
const NEAR_DISTANCE = 2.25;
const SCENE_LENGTH = 7200;
const LIGHT_SPACING = 44;
const SIGN_SPACING = 760;

const ROUTE_NAMES = [
  "C1 都心環状線",
  "11号 台場線",
  "湾岸線 B",
  "C2 中央環状線",
] as const;

const SIGN_COPY = [
  ["都心環状線  C1", "銀座  GINZA", "↑"],
  ["北池袋・新宿", "KITA-IKEBUKURO", "↖"],
  ["湾岸線  B", "BAYSHORE ROUTE", "↗"],
  ["芝公園  400m", "SHIBA-KOEN", "↑"],
  ["一ノ橋 JCT", "ICHINOHASHI JCT", "↗"],
] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
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

  const roadPoints: RoadPoint[] = [];
  const sceneObjects: SceneObject[] = [];
  const vehicles: TrafficVehicle[] = [];

  const initialVehicleCount = 7;
  for (let index = 0; index < initialVehicleCount; index += 1) {
    const kindRoll = seeded(index, 91);
    vehicles.push({
      id: index,
      z: 88 + index * 118 + seeded(index, 17) * 76,
      lane: seeded(index, 41) > 0.5 ? 1 : -1,
      closingSpeed: 4.8 + seeded(index, 29) * 7.4,
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
    roadSliceCount = quality === "MOBILE" ? 66 : quality === "BALANCED" ? 88 : 108;
    focalLength = cssHeight * (cssWidth < cssHeight ? 0.86 : 1.02);
    horizon = cssHeight * (cssWidth < cssHeight ? 0.35 : 0.385);

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
    const distanceRatio = FAR_DISTANCE / NEAR_DISTANCE;
    for (let index = 0; index <= roadSliceCount; index += 1) {
      const t = index / roadSliceCount;
      const z = NEAR_DISTANCE * Math.pow(distanceRatio, t);
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
    if (z < 46 || z > FAR_DISTANCE + 80) return;
    const occupancy = seeded(index * 2 + (side > 0 ? 1 : 0), 101);
    if (occupancy < (quality === "MOBILE" ? 0.2 : 0.12)) return;

    const lateral =
      side *
      (ROAD_HALF_WIDTH +
        13 +
        seeded(index, side > 0 ? 113 : 127) * 68);
    const base = projectedAt(z, lateral);
    const widthMeters = 11 + seeded(index, 139 + side) * 26;
    let heightMeters = 13 + seeded(index, 151 - side) * 63;
    if (seeded(index, 163) > 0.9) heightMeters += 48;

    const width = widthMeters * base.scale;
    const height = heightMeters * base.scale;
    if (width < 1 || height < 2 || base.x + width < -20 || base.x - width > cssWidth + 20) {
      return;
    }

    const left = base.x - width * 0.5;
    const top = base.groundY - height;
    const bodyLightness = Math.round(8 + seeded(index, 181) * 8);
    const atmosphericAlpha = clamp(1.02 - z / 1550, 0.28, 0.92);
    context.globalAlpha = atmosphericAlpha;
    context.fillStyle = `rgb(${bodyLightness - 2}, ${bodyLightness + 2}, ${bodyLightness + 6})`;
    context.fillRect(left, top, width, height + 2);

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

    if (height > 11 && width > 5) {
      const realRows = Math.max(3, Math.floor(heightMeters / 3.35));
      const realColumns = Math.max(2, Math.floor(widthMeters / 3.1));
      const maximumRows = quality === "MOBILE" ? 12 : 22;
      const rowStep = Math.max(1, Math.ceil(realRows / maximumRows));
      const columnStep = Math.max(1, Math.ceil(realColumns / 9));
      const windowWidth = clamp(base.scale * 1.35, 0.65, width * 0.13);
      const windowHeight = clamp(base.scale * 0.72, 0.55, 3.4);

      for (let row = 1; row < realRows; row += rowStep) {
        const windowY = base.groundY - (row + 0.78) * 3.35 * base.scale;
        if (windowY < top + 2) continue;
        for (let column = 0; column < realColumns; column += columnStep) {
          const windowHash = seeded(index * 101 + row * 13 + column, side * 17 + 229);
          if (windowHash < 0.82) continue;
          const windowX = left + (column + 0.86) * 3.1 * base.scale;
          if (windowX > left + width - 1) continue;
          const warm = windowHash > 0.968;
          context.fillStyle = warm
            ? "rgba(211, 187, 137, 0.72)"
            : windowHash > 0.91
              ? "rgba(166, 197, 209, 0.76)"
              : "rgba(116, 151, 166, 0.52)";
          context.fillRect(windowX, windowY, windowWidth, windowHeight);
          if (windowHash > 0.984 && base.scale > 0.45) {
            drawGlowDot(
              windowX + windowWidth * 0.5,
              windowY + windowHeight * 0.5,
              clamp(base.scale * 1.8, 2, 12),
              warm ? "rgba(255, 188, 105, 0.19)" : "rgba(143, 211, 239, 0.16)",
            );
          }
        }
      }
    }

    if (seeded(index, 271) > 0.95 && width > 34 && height > 50) {
      const boardWidth = width * 0.68;
      const boardHeight = clamp(height * 0.1, 13, 34);
      const boardX = left + width * 0.16;
      const boardY = top + height * 0.22;
      context.fillStyle = "rgba(197, 218, 222, 0.74)";
      context.fillRect(boardX, boardY, boardWidth, boardHeight);
      context.fillStyle = "rgba(27, 83, 108, 0.84)";
      context.font = `600 ${clamp(boardHeight * 0.38, 7, 13)}px sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("TOKYO 24", boardX + boardWidth * 0.5, boardY + boardHeight * 0.5);
      drawGlowDot(
        boardX + boardWidth * 0.5,
        boardY + boardHeight * 0.5,
        boardWidth * 0.55,
        "rgba(100, 190, 224, 0.07)",
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
    const spacing = quality === "MOBILE" ? 61 : 49;
    const first = Math.floor((totalDistanceMeters + 42) / spacing);
    const last = Math.ceil((totalDistanceMeters + FAR_DISTANCE + 60) / spacing);
    for (let index = last; index >= first; index -= 1) {
      const world = index * spacing + (seeded(index, 307) - 0.5) * spacing * 0.58;
      const z = world - totalDistanceMeters;
      drawBuilding(index, -1, z);
      drawBuilding(index, 1, z + (seeded(index, 311) - 0.5) * 14);
    }
  }

  function drawTokyoTower(): void {
    const firstBlock = Math.floor((totalDistanceMeters - 5700) / SCENE_LENGTH);
    for (let block = firstBlock; block <= firstBlock + 2; block += 1) {
      const towerWorld = block * SCENE_LENGTH + 5700;
      const z = towerWorld - totalDistanceMeters;
      if (z < 90 || z > FAR_DISTANCE) continue;
      const side: -1 | 1 = block % 2 === 0 ? 1 : -1;
      const lateral = side * (72 + seeded(block, 331) * 23);
      const base = projectedAt(z, lateral);
      const towerHeight = 146 * base.scale;
      const towerWidth = 31 * base.scale;
      if (towerHeight < 18 || base.x < -towerWidth || base.x > cssWidth + towerWidth) continue;

      const towerTop = base.groundY - towerHeight;
      const deckY = base.groundY - towerHeight * 0.58;
      context.save();
      context.globalAlpha = clamp(1 - z / 1700, 0.38, 0.96);
      context.strokeStyle = "rgba(245, 91, 35, 0.92)";
      context.lineCap = "round";
      context.lineWidth = clamp(base.scale * 1.05, 1.1, 5.5);
      context.beginPath();
      context.moveTo(base.x - towerWidth * 0.5, base.groundY);
      context.lineTo(base.x - towerWidth * 0.13, deckY);
      context.lineTo(base.x, towerTop);
      context.lineTo(base.x + towerWidth * 0.13, deckY);
      context.lineTo(base.x + towerWidth * 0.5, base.groundY);
      context.stroke();

      context.lineWidth = clamp(base.scale * 0.48, 0.7, 2.5);
      const braceCount = quality === "MOBILE" ? 6 : 10;
      for (let brace = 1; brace <= braceCount; brace += 1) {
        const t = brace / (braceCount + 1);
        const y = lerp(base.groundY, towerTop, t);
        const halfWidth = towerWidth * 0.5 * (1 - t * 0.85);
        context.beginPath();
        context.moveTo(base.x - halfWidth, y);
        context.lineTo(base.x + halfWidth, y);
        context.stroke();
      }

      context.strokeStyle = "rgba(244, 218, 155, 0.78)";
      context.lineWidth = clamp(base.scale * 0.28, 0.6, 1.5);
      context.beginPath();
      context.moveTo(base.x - towerWidth * 0.37, base.groundY - towerHeight * 0.14);
      context.lineTo(base.x + towerWidth * 0.24, deckY);
      context.moveTo(base.x + towerWidth * 0.37, base.groundY - towerHeight * 0.14);
      context.lineTo(base.x - towerWidth * 0.24, deckY);
      context.stroke();

      context.fillStyle = "rgba(238, 176, 93, 0.92)";
      context.fillRect(
        base.x - towerWidth * 0.2,
        deckY - clamp(base.scale * 1.1, 1, 7),
        towerWidth * 0.4,
        clamp(base.scale * 2.2, 2, 12),
      );
      drawGlowDot(
        base.x,
        base.groundY - towerHeight * 0.48,
        clamp(towerWidth * 0.72, 12, 100),
        "rgba(255, 79, 23, 0.22)",
      );
      drawGlowDot(base.x, towerTop, clamp(base.scale * 3, 3, 19), "rgba(255, 32, 18, 0.48)");
      context.restore();
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
    }

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

  function elevatedOffset(phase: number, level: number): number {
    if (level === 0) {
      const progress = clamp((phase - 1280) / 1220, 0, 1);
      return Math.cos(progress * Math.PI) * 19;
    }
    return -28 + Math.sin((phase - 1450) * 0.006) * 6;
  }

  function drawElevatedDecks(): void {
    for (let level = quality === "MOBILE" ? 0 : 1; level >= 0; level -= 1) {
      const heightMeters = level === 0 ? 8.6 : 14.2;
      const halfWidth = level === 0 ? 4.7 : 4.25;
      for (let index = roadPoints.length - 1; index >= 1; index -= 1) {
        const far = roadPoints[index];
        const near = roadPoints[index - 1];
        const farPhase = scenePhase(far.world);
        const nearPhase = scenePhase(near.world);
        const phaseInRange = (value: number) =>
          level === 0
            ? value >= 1280 && value <= 2500
            : value >= 1460 && value <= 2320;
        if (!phaseInRange(farPhase) || !phaseInRange(nearPhase)) continue;

        const farOffset = elevatedOffset(farPhase, level);
        const nearOffset = elevatedOffset(nearPhase, level);
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

    const lightFirst = Math.floor((totalDistanceMeters + 10) / LIGHT_SPACING);
    const lightLast = Math.ceil((totalDistanceMeters + FAR_DISTANCE) / LIGHT_SPACING);
    for (let index = lightFirst; index <= lightLast; index += 1) {
      const world = index * LIGHT_SPACING;
      const z = world - totalDistanceMeters;
      if (z < 7 || z > FAR_DISTANCE) continue;
      sceneObjects.push({
        kind: "light",
        z,
        index,
        side: index % 2 === 0 ? -1 : 1,
      });
    }

    const signFirst = Math.floor((totalDistanceMeters - 210) / SIGN_SPACING);
    const signLast = Math.ceil((totalDistanceMeters + FAR_DISTANCE - 210) / SIGN_SPACING);
    for (let index = signFirst; index <= signLast; index += 1) {
      const world = index * SIGN_SPACING + 210;
      const z = world - totalDistanceMeters;
      if (z > 24 && z < FAR_DISTANCE) {
        sceneObjects.push({ kind: "sign", z, index });
      }
    }

    const firstBlock = Math.floor((totalDistanceMeters - 2200) / SCENE_LENGTH);
    for (let block = firstBlock; block <= firstBlock + 2; block += 1) {
      const anchors = [1640, 2035, 2260];
      for (let level = 0; level < anchors.length; level += 1) {
        const world = block * SCENE_LENGTH + anchors[level];
        const z = world - totalDistanceMeters;
        if (z > 12 && z < FAR_DISTANCE) {
          sceneObjects.push({
            kind: "overpass",
            z,
            index: block * 3 + level,
            level,
          });
        }
      }
    }

    const activeVehicleCount = quality === "MOBILE" ? 5 : vehicles.length;
    for (let index = 0; index < activeVehicleCount; index += 1) {
      const vehicle = vehicles[index];
      if (vehicle.z > 4 && vehicle.z < FAR_DISTANCE) {
        sceneObjects.push({ kind: "vehicle", z: vehicle.z, vehicle });
      }
    }

    sceneObjects.sort((first, second) => second.z - first.z);
  }

  function drawStreetLight(object: Extract<SceneObject, { kind: "light" }>): void {
    const phase = scenePhase(totalDistanceMeters + object.z);
    const cool = phase >= 1280 && phase <= 4300;
    const lateral = object.side * (ROAD_HALF_WIDTH + 1.7);
    const height = cool ? 8.8 : 8.2;
    const base = projectedAt(object.z, lateral);
    const top = projectedAt(object.z, lateral, height);
    const armLength = clamp(base.scale * 0.85, 1.5, 18);
    const lampX = top.x - object.side * armLength;

    if (base.x < -80 || base.x > cssWidth + 80 || top.y > cssHeight + 20) return;
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
    drawGlowDot(
      lampX,
      top.y,
      clamp(6 + base.scale * 2.7, 7, 58),
      cool ? "rgba(141, 215, 247, 0.48)" : "rgba(255, 143, 65, 0.5)",
    );
  }

  function drawOverpass(object: Extract<SceneObject, { kind: "overpass" }>): void {
    const base = projectedAt(object.z);
    const height = 7.5 + object.level * 1.15;
    const deckY = base.groundY - height * base.scale;
    const deckHalfWidth = 47 * base.scale;
    const thickness = clamp(1.35 * base.scale, 2, cssHeight * 0.18);
    if (deckY > cssHeight + thickness || deckY < -cssHeight * 0.4) return;

    const fogAlpha = clamp(1.2 - object.z / 1300, 0.34, 1);
    context.save();
    context.globalAlpha = fogAlpha;
    const deckGradient = context.createLinearGradient(0, deckY, 0, deckY + thickness);
    deckGradient.addColorStop(0, object.level === 1 ? "#465157" : "#3a4449");
    deckGradient.addColorStop(0.28, "#252d31");
    deckGradient.addColorStop(1, "#10161a");
    context.fillStyle = deckGradient;
    context.fillRect(base.x - deckHalfWidth, deckY, deckHalfWidth * 2, thickness);

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
    const variant = positiveModulo(object.index, SIGN_COPY.length);
    const copy = SIGN_COPY[variant];
    const base = projectedAt(object.z);
    const signHeightMeters = 7.15;
    const signCenterY = base.groundY - signHeightMeters * base.scale;
    const boardWidth = 9.2 * base.scale;
    const boardHeight = 2.15 * base.scale;
    if (
      boardWidth < 5 ||
      signCenterY + boardHeight < -20 ||
      signCenterY - boardHeight > cssHeight + 20
    ) {
      return;
    }

    const boardX = base.x - boardWidth * 0.5;
    const boardY = signCenterY - boardHeight * 0.5;
    const poleWidth = clamp(base.scale * 0.16, 0.5, 4);
    context.strokeStyle = "rgba(118, 132, 135, 0.76)";
    context.lineWidth = poleWidth;
    context.beginPath();
    context.moveTo(base.x - boardWidth * 0.43, base.groundY);
    context.lineTo(base.x - boardWidth * 0.43, boardY + boardHeight);
    context.moveTo(base.x + boardWidth * 0.43, base.groundY);
    context.lineTo(base.x + boardWidth * 0.43, boardY + boardHeight);
    context.stroke();

    context.fillStyle = "#0c513d";
    context.fillRect(boardX, boardY, boardWidth, boardHeight);
    context.strokeStyle = "rgba(221, 235, 224, 0.86)";
    context.lineWidth = clamp(base.scale * 0.08, 0.6, 2.4);
    context.strokeRect(
      boardX + context.lineWidth,
      boardY + context.lineWidth,
      Math.max(0, boardWidth - context.lineWidth * 2),
      Math.max(0, boardHeight - context.lineWidth * 2),
    );

    if (boardWidth > 42) {
      context.fillStyle = "rgba(238, 243, 236, 0.94)";
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.font = `600 ${clamp(boardHeight * 0.24, 7, 20)}px sans-serif`;
      context.fillText(copy[0], boardX + boardWidth * 0.07, boardY + boardHeight * 0.32);
      context.font = `500 ${clamp(boardHeight * 0.16, 6, 13)}px sans-serif`;
      context.fillText(copy[1], boardX + boardWidth * 0.07, boardY + boardHeight * 0.66);
      context.font = `700 ${clamp(boardHeight * 0.38, 10, 32)}px sans-serif`;
      context.textAlign = "right";
      context.fillText(copy[2], boardX + boardWidth * 0.91, boardY + boardHeight * 0.59);
    }
    drawGlowDot(
      base.x,
      signCenterY,
      clamp(boardWidth * 0.62, 8, 72),
      "rgba(46, 146, 121, 0.1)",
    );
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
    if (width < 1.5 || base.x + width < 0 || base.x - width > cssWidth) return;

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
        "rgba(255, 34, 22, 0.5)",
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
  }

  function drawSceneObjects(): void {
    for (const object of sceneObjects) {
      if (object.kind === "light") drawStreetLight(object);
      else if (object.kind === "sign") drawSign(object);
      else if (object.kind === "overpass") drawOverpass(object);
      else drawVehicle(object);
    }
  }

  function drawBarrierSegment(
    far: RoadPoint,
    near: RoadPoint,
    side: -1 | 1,
    wallHeight: number,
    color: string,
  ): void {
    const lateral = side * (ROAD_HALF_WIDTH + 0.61);
    const farX = far.center + lateral * far.scale;
    const nearX = near.center + lateral * near.scale;
    const farTop = far.y - wallHeight * far.scale;
    const nearTop = near.y - wallHeight * near.scale;
    context.fillStyle = color;
    fillPolygon(context, [
      [farX, far.y],
      [farX, farTop],
      [nearX, nearTop],
      [nearX, near.y + 1],
    ]);
  }

  function drawBarriers(): void {
    for (let index = roadPoints.length - 1; index >= 1; index -= 1) {
      const far = roadPoints[index];
      const near = roadPoints[index - 1];
      const alternating = (Math.floor(far.world / 11) & 1) === 0;
      drawBarrierSegment(
        far,
        near,
        -1,
        0.88,
        alternating ? "#777c7c" : "#707575",
      );
      drawBarrierSegment(
        far,
        near,
        1,
        0.82,
        alternating ? "#7d8383" : "#737a7b",
      );

      const phase = scenePhase((far.world + near.world) * 0.5);
      if (phase >= 2670 && phase <= 3730) {
        const panelAlpha = clamp(0.82 - far.z / 2100, 0.35, 0.78);
        drawBarrierSegment(
          far,
          near,
          -1,
          3.25,
          `rgba(75, 88, 95, ${panelAlpha})`,
        );
        if (phase < 3360) {
          drawBarrierSegment(
            far,
            near,
            1,
            2.75,
            `rgba(80, 94, 101, ${panelAlpha * 0.88})`,
          );
        }
      }
    }

    for (const side of [-1, 1] as const) {
      context.strokeStyle = side < 0
        ? "rgba(191, 204, 207, 0.64)"
        : "rgba(170, 185, 190, 0.56)";
      context.lineWidth = 1;
      context.beginPath();
      for (let index = roadPoints.length - 1; index >= 0; index -= 1) {
        const point = roadPoints[index];
        const x = point.center + side * (ROAD_HALF_WIDTH + 0.61) * point.scale;
        const y = point.y - (side < 0 ? 0.88 : 0.82) * point.scale;
        if (index === roadPoints.length - 1) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }

    const blockStart = Math.floor((totalDistanceMeters - 6000) / SCENE_LENGTH) - 1;
    for (let block = blockStart; block <= blockStart + 3; block += 1) {
      const start = block * SCENE_LENGTH + 6000;
      for (let panel = 0; panel < 132; panel += 1) {
        const worldNear = start + panel * 7.4;
        const zNear = worldNear - totalDistanceMeters;
        const zFar = zNear + 6.5;
        if (zFar < NEAR_DISTANCE || zNear > FAR_DISTANCE) continue;
        const side: -1 | 1 = block % 2 === 0 ? 1 : -1;
        const near = projectedAt(Math.max(zNear, NEAR_DISTANCE), side * (ROAD_HALF_WIDTH + 0.62));
        const far = projectedAt(Math.min(zFar, FAR_DISTANCE), side * (ROAD_HALF_WIDTH + 0.62));
        const nearTopY = near.groundY - near.scale * 0.78;
        const farTopY = far.groundY - far.scale * 0.78;
        context.fillStyle = "rgba(230, 230, 220, 0.74)";
        fillPolygon(context, [
          [far.x, far.groundY],
          [far.x, farTopY],
          [near.x, nearTopY],
          [near.x, near.groundY],
        ]);
        context.fillStyle = "rgba(189, 42, 31, 0.94)";
        fillPolygon(context, [
          [far.x, farTopY + (far.groundY - farTopY) * 0.1],
          [near.x, nearTopY + (near.groundY - nearTopY) * 0.48],
          [near.x, near.groundY - (near.groundY - nearTopY) * 0.08],
          [far.x, far.groundY - (far.groundY - farTopY) * 0.42],
        ]);
      }
    }

    const postFirst = Math.floor((totalDistanceMeters + 5) / 9.2);
    const postLast = Math.ceil((totalDistanceMeters + FAR_DISTANCE) / 9.2);
    context.strokeStyle = "rgba(124, 138, 143, 0.72)";
    for (let index = postFirst; index <= postLast; index += 1) {
      const world = index * 9.2;
      const phase = scenePhase(world);
      if (phase < 2670 || phase > 3730) continue;
      const z = world - totalDistanceMeters;
      if (z < 5 || z > FAR_DISTANCE) continue;
      for (const side of [-1, 1] as const) {
        if (side > 0 && phase >= 3360) continue;
        const base = projectedAt(z, side * (ROAD_HALF_WIDTH + 0.62));
        const top = projectedAt(z, side * (ROAD_HALF_WIDTH + 0.62), side < 0 ? 3.3 : 2.8);
        context.lineWidth = clamp(base.scale * 0.1, 0.45, 3);
        context.beginPath();
        context.moveTo(base.x, base.groundY);
        context.lineTo(top.x, top.y);
        context.stroke();
      }
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
    leftWash.addColorStop(0, "rgba(128, 192, 218, 0.12)");
    leftWash.addColorStop(0.38, "rgba(88, 145, 171, 0.045)");
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
    rightWash.addColorStop(0, "rgba(103, 160, 185, 0.075)");
    rightWash.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = rightWash;
    context.fillRect(cssWidth * 0.45, horizon, cssWidth * 0.55, cssHeight - horizon);
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
    drawTokyoTower();
    drawElevatedDecks();
    drawRoadBase();
    drawRoadMarkings();
    collectSceneObjects();
    drawSceneObjects();
    drawBarriers();
    drawHeadlightReflections();
    compositeBloom();
    drawAtmosphereAndGrain();
  }

  function recycleVehicle(vehicle: TrafficVehicle): void {
    vehicle.generation += 1;
    const seed = vehicle.id * 131 + vehicle.generation * 19;
    const farthestVehicle = Math.max(360, ...vehicles.map((item) => item.z));
    vehicle.z = farthestVehicle + 105 + seeded(seed, 367) * 260;
    vehicle.lane = seeded(seed, 373) > 0.5 ? 1 : -1;
    vehicle.closingSpeed = 4.7 + seeded(seed, 379) * 8.4;
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
    const block = Math.floor(totalDistanceMeters / SCENE_LENGTH);
    const phase = scenePhase(totalDistanceMeters);
    let sceneName: string;
    if (phase < 1280) sceneName = "都心ビル群・深夜";
    else if (phase < 2580) sceneName = "多層高架ジャンクション";
    else if (phase < 3820) sceneName = "防音壁区間・冷白灯";
    else if (phase < 4920) sceneName = "汐留スカイライン";
    else if (phase < 5900) sceneName = "芝公園・東京タワー遠望";
    else sceneName = "都心環状ロングカーブ";
    return {
      routeName: ROUTE_NAMES[positiveModulo(block, ROUTE_NAMES.length)],
      sceneName,
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
