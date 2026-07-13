export type ProceduralSurfaceAssets = {
  asphalt: CanvasImageSource;
  concrete: CanvasImageSource;
  soundwall: CanvasImageSource;
  metal: CanvasImageSource;
};

export type ProceduralSignSprite = {
  canvas: CanvasImageSource;
  widthMeters: number;
  heightMeters: number;
  glowColor: string;
  family: string;
};

export type ProceduralAssets = {
  surfaces: ProceduralSurfaceAssets;
  signs: ProceduralSignSprite[];
};

type CanvasLike = HTMLCanvasElement | OffscreenCanvas;
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

type SignPalette = {
  background: string;
  edge: string;
  foreground: string;
  glow: string;
};

type SignDefinition = {
  family: string;
  widthMeters: number;
  heightMeters: number;
  palette: SignPalette;
  render: (context: Context2D, width: number, height: number) => void;
};

let cachedAssets: ProceduralAssets | undefined;

function createCanvas(width: number, height: number): CanvasLike {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("Procedural assets require a browser canvas implementation.");
}

function getContext(canvas: CanvasLike): Context2D {
  const context = canvas.getContext("2d") as Context2D | null;
  if (!context) throw new Error("Could not create a 2D canvas context.");
  return context;
}

function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function lattice(seed: number, x: number, y: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed, 0x45d9f3b) ^ Math.imul(wrappedY + seed * 3, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicNoise(seed: number, u: number, v: number, periodX: number, periodY: number): number {
  const px = u * periodX;
  const py = v * periodY;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const tx = smooth(px - x0);
  const ty = smooth(py - y0);
  const top = lattice(seed, x0, y0, periodX, periodY) * (1 - tx) + lattice(seed, x0 + 1, y0, periodX, periodY) * tx;
  const bottom = lattice(seed, x0, y0 + 1, periodX, periodY) * (1 - tx) + lattice(seed, x0 + 1, y0 + 1, periodX, periodY) * tx;
  return top * (1 - ty) + bottom * ty;
}

function fbm(seed: number, u: number, v: number): number {
  return (
    periodicNoise(seed, u, v, 4, 8) * 0.48 +
    periodicNoise(seed + 17, u, v, 12, 24) * 0.29 +
    periodicNoise(seed + 41, u, v, 36, 72) * 0.15 +
    periodicNoise(seed + 79, u, v, 96, 192) * 0.08
  );
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function fillMaterial(
  canvas: CanvasLike,
  seed: number,
  shade: (u: number, v: number, noise: number, grain: number) => readonly [number, number, number, number?],
): Context2D {
  const width = canvas.width;
  const height = canvas.height;
  const context = getContext(canvas);
  const image = context.createImageData(width, height);
  const pixels = image.data;
  for (let y = 0; y < height; y += 1) {
    const v = y / height;
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const grain = lattice(seed + 211, x, y, width, height);
      const color = shade(u, v, fbm(seed, u, v), grain);
      const offset = (y * width + x) * 4;
      pixels[offset] = clampByte(color[0]);
      pixels[offset + 1] = clampByte(color[1]);
      pixels[offset + 2] = clampByte(color[2]);
      pixels[offset + 3] = clampByte(color[3] ?? 255);
    }
  }
  context.putImageData(image, 0, 0);
  return context;
}

function tileCopies(context: Context2D, width: number, height: number, draw: () => void): void {
  for (const offsetY of [-height, 0, height]) {
    for (const offsetX of [-width, 0, width]) {
      context.save();
      context.translate(offsetX, offsetY);
      draw();
      context.restore();
    }
  }
}

function drawCracks(context: Context2D, width: number, height: number, seed: number, count: number): void {
  const random = randomSource(seed);
  context.lineCap = "round";
  for (let index = 0; index < count; index += 1) {
    const startX = random() * width;
    const startY = random() * height;
    const points: Array<[number, number]> = [[startX, startY]];
    let x = startX;
    let y = startY;
    const segments = 4 + Math.floor(random() * 7);
    for (let segment = 0; segment < segments; segment += 1) {
      x += (random() - 0.5) * 22;
      y += 9 + random() * 20;
      points.push([x, y]);
    }
    context.strokeStyle = `rgba(4, 8, 11, ${0.18 + random() * 0.24})`;
    context.lineWidth = 0.5 + random() * 1.1;
    tileCopies(context, width, height, () => {
      context.beginPath();
      context.moveTo(points[0][0], points[0][1]);
      for (let point = 1; point < points.length; point += 1) context.lineTo(points[point][0], points[point][1]);
      context.stroke();
    });
  }
}

function createAsphalt(): CanvasLike {
  const canvas = createCanvas(512, 1024);
  const context = fillMaterial(canvas, 701, (u, v, noise, grain) => {
    const wheel = Math.exp(-Math.pow((u - 0.27) / 0.085, 2)) + Math.exp(-Math.pow((u - 0.73) / 0.085, 2));
    const aggregate = grain > 0.91 ? 18 : grain < 0.08 ? -12 : (grain - 0.5) * 7;
    const patch = u > 0.07 && u < 0.39 && v > 0.34 && v < 0.61 ? -7 : 0;
    const tone = 36 + (noise - 0.5) * 24 + aggregate - wheel * 4 + patch;
    return [tone * 0.88, tone * 0.96, tone, 255];
  });
  context.strokeStyle = "rgba(78, 88, 92, .22)";
  context.lineWidth = 2;
  context.strokeRect(36, 350, 170, 280);
  drawCracks(context, 512, 1024, 917, 34);
  return canvas;
}

function createConcrete(): CanvasLike {
  const canvas = createCanvas(512, 512);
  const context = fillMaterial(canvas, 1103, (u, v, noise, grain) => {
    const streak = Math.sin(u * Math.PI * 18 + periodicNoise(59, 0, v, 1, 8) * 3) * 2;
    const speck = grain > 0.93 ? 15 : grain < 0.06 ? -12 : 0;
    const tone = 126 + (noise - 0.5) * 31 + streak + speck;
    return [tone * 0.9, tone * 0.94, tone * 0.96, 255];
  });
  context.strokeStyle = "rgba(35, 48, 54, .35)";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(0, 255.5);
  context.lineTo(512, 255.5);
  context.moveTo(255.5, 0);
  context.lineTo(255.5, 512);
  context.stroke();
  const random = randomSource(1201);
  for (let x = 64; x < 512; x += 128) {
    for (let y = 64; y < 512; y += 128) {
      context.fillStyle = "rgba(25, 37, 43, .48)";
      context.beginPath();
      context.arc(x + (random() - 0.5) * 4, y, 4.5, 0, Math.PI * 2);
      context.fill();
    }
  }
  drawCracks(context, 512, 512, 1277, 13);
  return canvas;
}

function createSoundwall(): CanvasLike {
  const canvas = createCanvas(512, 512);
  const context = fillMaterial(canvas, 1601, (u, v, noise, grain) => {
    const soot = Math.pow(Math.abs(Math.sin(v * Math.PI)), 7) * -11;
    const cloud = (noise - 0.5) * 48;
    const fine = (grain - 0.5) * 9;
    return [72 + cloud + fine + soot, 92 + cloud + fine + soot, 105 + cloud + fine + soot, 232];
  });
  context.fillStyle = "rgba(18, 27, 32, .86)";
  context.fillRect(0, 0, 18, 512);
  context.fillRect(247, 0, 18, 512);
  context.fillRect(494, 0, 18, 512);
  context.fillRect(0, 0, 512, 22);
  context.fillRect(0, 490, 512, 22);
  context.strokeStyle = "rgba(190, 210, 216, .34)";
  context.lineWidth = 2;
  context.strokeRect(19, 23, 227, 466);
  context.strokeRect(266, 23, 227, 466);
  const random = randomSource(1699);
  context.fillStyle = "rgba(8, 14, 18, .14)";
  for (let index = 0; index < 150; index += 1) {
    context.beginPath();
    context.arc(random() * 512, random() * 512, 1 + random() * 4, 0, Math.PI * 2);
    context.fill();
  }
  return canvas;
}

function createMetal(): CanvasLike {
  const canvas = createCanvas(512, 512);
  const context = fillMaterial(canvas, 2003, (u, v, noise, grain) => {
    const brushed = Math.sin(v * Math.PI * 170) * 2.5;
    const tone = 61 + (noise - 0.5) * 25 + (grain - 0.5) * 6 + brushed;
    return [tone * 0.78, tone * 0.9, tone, 255];
  });
  context.fillStyle = "rgba(13, 22, 27, .7)";
  context.fillRect(0, 78, 512, 62);
  context.fillRect(0, 366, 512, 62);
  context.fillStyle = "rgba(107, 124, 130, .55)";
  context.fillRect(0, 84, 512, 7);
  context.fillRect(0, 372, 512, 7);
  context.strokeStyle = "rgba(16, 25, 29, .92)";
  context.lineWidth = 18;
  context.beginPath();
  context.moveTo(0, 247);
  context.lineTo(512, 247);
  context.stroke();
  context.strokeStyle = "rgba(146, 164, 169, .58)";
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(0, 242);
  context.lineTo(512, 242);
  context.stroke();
  for (let x = 24; x < 512; x += 48) {
    for (const y of [108, 396]) {
      context.fillStyle = "rgba(8, 13, 16, .9)";
      context.beginPath();
      context.arc(x, y, 6, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "rgba(175, 188, 190, .5)";
      context.beginPath();
      context.arc(x - 1.5, y - 1.5, 2, 0, Math.PI * 2);
      context.fill();
    }
  }
  return canvas;
}

function roundedRect(context: Context2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function paintBoard(context: Context2D, width: number, height: number, palette: SignPalette, seed: number): void {
  roundedRect(context, 4, 4, width - 8, height - 8, Math.max(9, height * 0.045));
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, palette.background);
  gradient.addColorStop(0.68, palette.background);
  gradient.addColorStop(1, palette.background);
  context.fillStyle = gradient;
  context.fill();
  context.strokeStyle = palette.edge;
  context.lineWidth = Math.max(5, height * 0.025);
  context.stroke();
  const random = randomSource(seed);
  context.fillStyle = "rgba(255,255,255,.045)";
  for (let index = 0; index < Math.floor(width * height / 1400); index += 1) {
    context.fillRect(random() * width, random() * height, 1 + random() * 2, 1 + random() * 2);
  }
}

function text(
  context: Context2D,
  value: string,
  x: number,
  y: number,
  maximumWidth: number,
  initialSize: number,
  color: string,
  weight = 700,
  align: CanvasTextAlign = "center",
): void {
  let size = initialSize;
  context.textAlign = align;
  context.textBaseline = "middle";
  context.fillStyle = color;
  while (size > 14) {
    context.font = `${weight} ${size}px "Hiragino Sans", "Yu Gothic", sans-serif`;
    if (context.measureText(value).width <= maximumWidth) break;
    size -= 2;
  }
  context.fillText(value, x, y);
}

function badge(context: Context2D, x: number, y: number, size: number, value: string, color: string): void {
  roundedRect(context, x - size / 2, y - size / 2, size, size, size * 0.2);
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = "rgba(255,255,255,.9)";
  context.lineWidth = Math.max(3, size * 0.045);
  context.stroke();
  text(context, value, x, y + size * 0.02, size * 0.82, size * 0.48, "#fff", 800);
}

function routeMark(context: Context2D, x: number, y: number, size: number, value: string): void {
  context.save();
  context.fillStyle = "rgba(4, 105, 55, .72)";
  context.strokeStyle = "rgba(255,255,255,.96)";
  context.lineWidth = Math.max(3, size * 0.055);
  if (value.startsWith("C")) {
    context.beginPath();
    context.arc(x, y, size * 0.43, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  } else {
    roundedRect(context, x - size * 0.42, y - size * 0.46, size * 0.84, size * 0.92, size * 0.16);
    context.fill();
    context.stroke();
  }
  text(context, value, x, y + size * 0.015, size * 0.7, size * 0.46, "#fff", 800);
  context.restore();
}

function exitNumberBox(
  context: Context2D,
  x: number,
  y: number,
  width: number,
  height: number,
  value: string,
): void {
  context.fillStyle = "#f4fff6";
  context.fillRect(x, y, width, height);
  text(
    context,
    value,
    x + width * 0.5,
    y + height * 0.52,
    width * 0.9,
    height * 0.58,
    "#087b3d",
    800,
  );
}

function arrow(context: Context2D, x: number, y: number, length: number, direction: "up" | "left" | "right", color: string): void {
  context.save();
  context.translate(x, y);
  context.rotate(direction === "left" ? -Math.PI / 2 : direction === "right" ? Math.PI / 2 : 0);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Math.max(6, length * 0.12);
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(0, length * 0.45);
  context.lineTo(0, -length * 0.32);
  context.stroke();
  context.beginPath();
  context.moveTo(0, -length * 0.5);
  context.lineTo(-length * 0.22, -length * 0.2);
  context.lineTo(length * 0.22, -length * 0.2);
  context.closePath();
  context.fill();
  context.restore();
}

const GREEN: SignPalette = { background: "#168944", edge: "#e9fff1", foreground: "#f7fff9", glow: "#72e6a5" };
const BLUE: SignPalette = { background: "#1467aa", edge: "#e9f6ff", foreground: "#f7fbff", glow: "#68c7ff" };
const LED: SignPalette = { background: "#11100d", edge: "#4c514d", foreground: "#ff9b26", glow: "#ff7a18" };
const DARK: SignPalette = { background: "#101b22", edge: "#a7b9bd", foreground: "#eaf7f3", glow: "#62ffc7" };

function routeSign(title: string, subtitle: string, route: string, direction: "up" | "left" | "right"): SignDefinition["render"] {
  return (context, width, height) => {
    routeMark(context, width * 0.15, height * 0.27, height * 0.34, route);
    text(context, title, width * 0.47, height * 0.25, width * 0.56, height * 0.24, "#fff", 800);
    text(context, subtitle, width * 0.47, height * 0.48, width * 0.58, height * 0.115, "#f4fff7", 650);
    arrow(context, width * 0.79, height * 0.74, height * 0.36, direction, "#fff");
  };
}

function definitions(): SignDefinition[] {
  return [
    { family: "green-central-loop", widthMeters: 8.6, heightMeters: 3.1, palette: GREEN, render: routeSign("神田橋", "Kandabashi / Ginza", "C1", "up") },
    { family: "green-central-loop-left", widthMeters: 8.8, heightMeters: 3.1, palette: GREEN, render: routeSign("北池袋・新宿", "Kita-ikebukuro / Shinjuku", "5", "left") },
    { family: "green-bayshore", widthMeters: 8.8, heightMeters: 3.1, palette: GREEN, render: routeSign("湾岸線・羽田", "Bayshore Route / Haneda", "B", "right") },
    {
      family: "green-exit",
      widthMeters: 11.2,
      heightMeters: 3.2,
      palette: GREEN,
      render: (c, w, h) => {
        c.fillStyle = "#1467aa";
        c.fillRect(w * .025, h * .045, w * .255, h * .91);
        c.strokeStyle = "rgba(255,255,255,.88)";
        c.lineWidth = Math.max(3, h * .014);
        c.beginPath();
        c.moveTo(w * .28, h * .07);
        c.lineTo(w * .28, h * .93);
        c.stroke();
        text(c, "神保町", w * .152, h * .22, w * .205, h * .18, "#fff", 800);
        text(c, "Jinbocho", w * .152, h * .39, w * .205, h * .095, "#fff", 650);
        text(c, "飯田橋", w * .152, h * .61, w * .205, h * .18, "#fff", 800);
        text(c, "Iidabashi", w * .152, h * .78, w * .205, h * .095, "#fff", 650);
        text(c, "西神田", w * .51, h * .235, w * .39, h * .23, "#fff", 800);
        text(c, "Nishi-kanda", w * .51, h * .45, w * .4, h * .105, "#fff", 650);
        exitNumberBox(c, w * .325, h * .68, w * .285, h * .2, "出口 501");
        text(c, "400m", w * .72, h * .79, w * .16, h * .145, "#fff", 750);
        arrow(c, w * .87, h * .55, h * .41, "right", "#fff");
      },
    },
    { family: "green-junction", widthMeters: 9.4, heightMeters: 3.1, palette: GREEN, render: routeSign("箱崎 JCT", "Hakozaki Junction", "6", "right") },
    {
      family: "green-double-panel",
      widthMeters: 13,
      heightMeters: 3.3,
      palette: GREEN,
      render: (c, w, h) => {
        c.strokeStyle = "rgba(255,255,255,.84)";
        c.lineWidth = Math.max(3, h * .015);
        c.beginPath();
        c.moveTo(w * .5, h * .06);
        c.lineTo(w * .5, h * .76);
        c.stroke();
        routeMark(c, w * .105, h * .26, h * .3, "5");
        routeMark(c, w * .595, h * .26, h * .3, "C1");
        text(c, "北池袋", w * .305, h * .235, w * .315, h * .19, "#fff", 800);
        text(c, "Kita-ikebukuro", w * .305, h * .445, w * .32, h * .095, "#fff", 650);
        text(c, "神田橋・箱崎", w * .795, h * .235, w * .32, h * .185, "#fff", 800);
        text(c, "Kandabashi / Hakozaki", w * .795, h * .445, w * .34, h * .082, "#fff", 650);
        arrow(c, w * .305, h * .72, h * .31, "left", "#fff");
        arrow(c, w * .795, h * .72, h * .31, "up", "#fff");
        roundedRect(c, w * .438, h * .79, w * .124, h * .15, h * .025);
        c.fillStyle = "#168944";
        c.fill();
        c.strokeStyle = "rgba(255,255,255,.86)";
        c.lineWidth = Math.max(2, h * .01);
        c.stroke();
        text(c, "500m", w * .5, h * .865, w * .105, h * .087, "#fff", 700);
      },
    },
    {
      family: "green-next-exit",
      widthMeters: 11.4,
      heightMeters: 3.2,
      palette: GREEN,
      render: (c, w, h) => {
        c.fillStyle = "#1467aa";
        c.fillRect(w * .025, h * .045, w * .255, h * .91);
        c.strokeStyle = "rgba(255,255,255,.86)";
        c.lineWidth = Math.max(3, h * .014);
        c.beginPath();
        c.moveTo(w * .28, h * .07);
        c.lineTo(w * .28, h * .93);
        c.moveTo(w * .68, h * .07);
        c.lineTo(w * .68, h * .93);
        c.stroke();
        text(c, "霞が関", w * .152, h * .31, w * .205, h * .2, "#fff", 800);
        text(c, "Kasumigaseki", w * .152, h * .53, w * .21, h * .095, "#fff", 650);
        text(c, "銀座", w * .48, h * .25, w * .3, h * .225, "#fff", 800);
        text(c, "Ginza", w * .48, h * .47, w * .3, h * .105, "#fff", 650);
        exitNumberBox(c, w * .345, h * .69, w * .27, h * .19, "出口 15");
        text(c, "次は", w * .825, h * .17, w * .22, h * .12, "#fff", 700);
        text(c, "NEXT EXIT", w * .825, h * .315, w * .22, h * .085, "#eaffef", 700);
        text(c, "芝公園", w * .825, h * .54, w * .23, h * .18, "#fff", 800);
        text(c, "Shibakoen", w * .825, h * .735, w * .23, h * .092, "#fff", 650);
      },
    },
    { family: "blue-parking", widthMeters: 4, heightMeters: 2, palette: BLUE, render: (c, w, h) => { badge(c, h * .48, h * .5, h * .62, "P", "#0968a4"); text(c, "芝浦 PA", w * .66, h * .36, w * .53, h * .25, "#fff"); text(c, "SHIBAURA  1 km", w * .66, h * .68, w * .54, h * .12, "#fff", 600); } },
    { family: "led-roadwork", widthMeters: 8, heightMeters: 2, palette: LED, render: (c, w, h) => { c.shadowColor = "#ff6b12"; c.shadowBlur = 22; text(c, "この先 工事", w * .5, h * .34, w * .84, h * .28, "#ff9b26", 800); text(c, "ROAD WORK  1 km", w * .5, h * .72, w * .82, h * .15, "#ffbd57", 700); c.shadowBlur = 0; } },
    { family: "led-congestion", widthMeters: 8, heightMeters: 2, palette: LED, render: (c, w, h) => { c.shadowColor = "#ff5419"; c.shadowBlur = 20; text(c, "渋滞  3 km", w * .5, h * .34, w * .82, h * .28, "#ff8c24", 800); text(c, "CONGESTION  20 MIN", w * .5, h * .72, w * .82, h * .15, "#ffc15c", 700); c.shadowBlur = 0; } },
    { family: "lane-control-open", widthMeters: 8, heightMeters: 3, palette: DARK, render: (c, w, h) => { text(c, "LANE CONTROL", w * .5, h * .18, w * .86, h * .13, "#d9ffff", 650); for (let i = 0; i < 3; i += 1) arrow(c, w * (.24 + i * .26), h * .63, h * .46, "up", i === 1 ? "#69ffb6" : "#54bfff"); } },
    { family: "lane-control-merge", widthMeters: 8, heightMeters: 3, palette: DARK, render: (c, w, h) => { text(c, "右車線 規制", w * .5, h * .2, w * .82, h * .17, "#fff", 750); arrow(c, w * .3, h * .67, h * .4, "up", "#61ffad"); c.strokeStyle = "#ff553d"; c.lineWidth = h * .09; c.beginPath(); c.moveTo(w * .65, h * .48); c.lineTo(w * .82, h * .78); c.moveTo(w * .82, h * .48); c.lineTo(w * .65, h * .78); c.stroke(); } },
    { family: "advertising-vertical-cyan", widthMeters: 3, heightMeters: 6, palette: { background: "#087f91", edge: "#d4fbff", foreground: "#fff", glow: "#54eaff" }, render: (c, w, h) => { text(c, "TOKYO", w * .5, h * .18, w * .78, h * .1, "#fff", 800); text(c, "AFTER", w * .5, h * .32, w * .78, h * .1, "#c8fbff", 800); text(c, "IMAGE", w * .5, h * .45, w * .78, h * .1, "#c8fbff", 800); c.strokeStyle = "#a9ffff"; c.lineWidth = w * .025; c.beginPath(); c.arc(w * .5, h * .68, w * .23, 0, Math.PI * 2); c.stroke(); text(c, "NIGHT CITY STUDIES", w * .5, h * .88, w * .82, h * .052, "#fff", 650); } },
    { family: "advertising-vertical-magenta", widthMeters: 3, heightMeters: 6, palette: { background: "#6c194f", edge: "#ffd3ee", foreground: "#fff", glow: "#ff5bc3" }, render: (c, w, h) => { text(c, "MIDNIGHT", w * .5, h * .21, w * .82, h * .075, "#fff", 800); text(c, "SIGNAL", w * .5, h * .34, w * .82, h * .1, "#ffbce9", 800); c.fillStyle = "rgba(255,180,227,.7)"; for (let i = 0; i < 6; i += 1) c.fillRect(w * (.18 + i * .11), h * (.5 + (i % 2) * .04), w * .035, h * .24); text(c, "URBAN FREQUENCY", w * .5, h * .86, w * .8, h * .052, "#fff", 650); } },
    { family: "advertising-blue-white", widthMeters: 8, heightMeters: 3, palette: { background: "#e8f5fa", edge: "#75bcdd", foreground: "#065f91", glow: "#55c8ff" }, render: (c, w, h) => { text(c, "BAY GLASS", w * .5, h * .34, w * .82, h * .25, "#096a9e", 800); c.fillStyle = "#3db7d4"; c.fillRect(w * .13, h * .55, w * .74, h * .045); text(c, "COASTAL LIGHT / TOKYO", w * .5, h * .73, w * .8, h * .1, "#174d6a", 650); } },
    { family: "advertising-cyan-horizontal", widthMeters: 8, heightMeters: 3, palette: { background: "#0c607d", edge: "#bbf1ff", foreground: "#fff", glow: "#4ed9ff" }, render: (c, w, h) => { text(c, "AETHER CITY", w * .5, h * .33, w * .84, h * .23, "#ddfaff", 800); text(c, "NEW TOKYO  2036", w * .5, h * .64, w * .8, h * .13, "#75e7ff", 700); text(c, "MOVE BEYOND", w * .5, h * .82, w * .72, h * .08, "#fff", 600); } },
    {
      family: "advertising-amber-transit",
      widthMeters: 10.4,
      heightMeters: 3.4,
      palette: { background: "#c64f16", edge: "#ffe0ac", foreground: "#fff", glow: "#ff9b42" },
      render: (c, w, h) => {
        c.fillStyle = "rgba(255,221,163,.28)";
        c.fillRect(w * .055, h * .12, w * .03, h * .76);
        c.fillRect(w * .105, h * .12, w * .012, h * .76);
        text(c, "NIGHT TRANSIT", w * .56, h * .38, w * .77, h * .27, "#fff7e9", 850);
        text(c, "TOKYO / ALL HOURS", w * .56, h * .71, w * .7, h * .115, "#ffd8a4", 700);
      },
    },
    {
      family: "advertising-red-kinetic",
      widthMeters: 9.4,
      heightMeters: 3.2,
      palette: { background: "#8e1930", edge: "#ffd0d8", foreground: "#fff", glow: "#ff526d" },
      render: (c, w, h) => {
        c.strokeStyle = "rgba(255,191,202,.6)";
        c.lineWidth = h * .035;
        c.beginPath();
        c.moveTo(w * .08, h * .77);
        c.lineTo(w * .19, h * .23);
        c.lineTo(w * .29, h * .77);
        c.stroke();
        text(c, "KINETIC CITY", w * .62, h * .38, w * .66, h * .255, "#fff", 850);
        text(c, "DRIVE THE SIGNAL", w * .62, h * .7, w * .62, h * .11, "#ffc3cf", 700);
      },
    },
    {
      family: "advertising-indigo-weather",
      widthMeters: 3.8,
      heightMeters: 7.2,
      palette: { background: "#282778", edge: "#c7d7ff", foreground: "#fff", glow: "#768dff" },
      render: (c, w, h) => {
        text(c, "NEON", w * .5, h * .19, w * .8, h * .12, "#fff", 850);
        text(c, "WEATHER", w * .5, h * .33, w * .82, h * .105, "#c6d5ff", 850);
        c.strokeStyle = "rgba(166,194,255,.72)";
        c.lineWidth = w * .035;
        c.beginPath();
        c.arc(w * .5, h * .58, w * .23, Math.PI * .15, Math.PI * 1.85);
        c.stroke();
        text(c, "TOKYO BAY", w * .5, h * .84, w * .8, h * .065, "#fff", 700);
      },
    },
    {
      family: "advertising-monochrome-standard",
      widthMeters: 10.2,
      heightMeters: 4,
      palette: { background: "#e9e5d9", edge: "#ffffff", foreground: "#10151a", glow: "#d9e5e8" },
      render: (c, w, h) => {
        c.fillStyle = "#11161c";
        c.fillRect(w * .055, h * .12, w * .18, h * .76);
        text(c, "M", w * .145, h * .5, w * .12, h * .34, "#f4efe3", 900);
        text(c, "MIDNIGHT STANDARD", w * .61, h * .39, w * .68, h * .215, "#11161c", 850);
        c.fillStyle = "#11161c";
        c.fillRect(w * .3, h * .59, w * .62, h * .025);
        text(c, "URBAN EQUIPMENT", w * .61, h * .75, w * .63, h * .095, "#29323a", 700);
      },
    },
    {
      family: "advertising-lime-electric",
      widthMeters: 9.2,
      heightMeters: 3.2,
      palette: { background: "#b9dc31", edge: "#efffb3", foreground: "#10200f", glow: "#cfff4d" },
      render: (c, w, h) => {
        c.fillStyle = "#162315";
        c.fillRect(w * .04, h * .08, w * .17, h * .84);
        text(c, "E", w * .125, h * .5, w * .11, h * .39, "#dfff67", 900);
        text(c, "ELECTRIC AVENUE", w * .6, h * .38, w * .69, h * .245, "#122010", 900);
        text(c, "ZERO EMISSION", w * .6, h * .7, w * .6, h * .115, "#263a19", 750);
      },
    },
    {
      family: "advertising-orange-radio",
      widthMeters: 3.6,
      heightMeters: 6.8,
      palette: { background: "#d95716", edge: "#ffe0a8", foreground: "#fff", glow: "#ff9639" },
      render: (c, w, h) => {
        text(c, "CITY", w * .5, h * .18, w * .78, h * .12, "#fff9ed", 900);
        text(c, "RADIO", w * .5, h * .32, w * .8, h * .115, "#fff9ed", 900);
        c.fillStyle = "rgba(75,27,12,.88)";
        roundedRect(c, w * .14, h * .48, w * .72, h * .18, w * .05);
        c.fill();
        text(c, "94.7 FM", w * .5, h * .57, w * .61, h * .085, "#ffd070", 850);
        text(c, "LIVE TOKYO", w * .5, h * .83, w * .76, h * .065, "#fff", 700);
      },
    },
    {
      family: "advertising-violet-orbit",
      widthMeters: 9.6,
      heightMeters: 3.4,
      palette: { background: "#4b2b80", edge: "#e2d1ff", foreground: "#fff", glow: "#b37aff" },
      render: (c, w, h) => {
        c.strokeStyle = "rgba(232,213,255,.72)";
        c.lineWidth = h * .025;
        c.beginPath();
        c.arc(w * .14, h * .5, h * .25, 0, Math.PI * 2);
        c.stroke();
        text(c, "ORBIT HOTEL", w * .59, h * .39, w * .69, h * .26, "#fff", 850);
        text(c, "NIGHT CHECK-IN", w * .59, h * .71, w * .62, h * .11, "#d9bfff", 700);
      },
    },
    {
      family: "advertising-white-mobility",
      widthMeters: 10.8,
      heightMeters: 3.5,
      palette: { background: "#eef4f2", edge: "#ffffff", foreground: "#102a32", glow: "#9ff7ef" },
      render: (c, w, h) => {
        c.fillStyle = "#0f8a88";
        c.fillRect(w * .05, h * .1, w * .2, h * .8);
        c.fillStyle = "#b5fff0";
        c.beginPath();
        c.moveTo(w * .1, h * .7);
        c.lineTo(w * .2, h * .3);
        c.lineTo(w * .2, h * .7);
        c.closePath();
        c.fill();
        text(c, "TOKYO MOTION", w * .62, h * .39, w * .66, h * .245, "#15313a", 900);
        text(c, "AFTER DARK", w * .62, h * .7, w * .54, h * .115, "#167878", 750);
      },
    },
  ];
}

function createSign(definition: SignDefinition, index: number): ProceduralSignSprite {
  const aspect = definition.widthMeters / definition.heightMeters;
  const width = aspect >= 1 ? 1024 : Math.round(1024 * aspect);
  const height = aspect >= 1 ? Math.round(1024 / aspect) : 1024;
  const canvas = createCanvas(width, height);
  const context = getContext(canvas);
  paintBoard(context, width, height, definition.palette, 3001 + index * 97);
  definition.render(context, width, height);
  return {
    canvas,
    family: definition.family,
    widthMeters: definition.widthMeters,
    heightMeters: definition.heightMeters,
    glowColor: definition.palette.glow,
  };
}

export function createProceduralAssets(): ProceduralAssets {
  if (cachedAssets) return cachedAssets;
  cachedAssets = {
    surfaces: {
      asphalt: createAsphalt(),
      concrete: createConcrete(),
      soundwall: createSoundwall(),
      metal: createMetal(),
    },
    signs: definitions().map(createSign),
  };
  return cachedAssets;
}
