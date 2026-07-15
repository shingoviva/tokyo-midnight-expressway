export type DriveMood = "quiet" | "rising" | "peak" | "afterglow";

export type DriveEventKind =
  | "taxi-overtake"
  | "truck-merge"
  | "maintenance-run";

export type DriveEventState = {
  kind: DriveEventKind;
  progressMeters: number;
  durationMeters: number;
  side: -1 | 1;
  variant: 0 | 1 | 2;
};

export type DriveDirectorState = {
  intensity: number;
  mood: DriveMood;
  cycleProgress: number;
  event: DriveEventState | null;
};

export const DRIVE_DIRECTOR_CYCLE_METERS = 7_200;

const EVENT_SLOTS: ReadonlyArray<{
  kind: DriveEventKind;
  start: number;
  duration: number;
}> = [
  { kind: "taxi-overtake", start: 400, duration: 1_100 },
  { kind: "truck-merge", start: 2_420, duration: 630 },
  { kind: "maintenance-run", start: 4_180, duration: 780 },
  { kind: "taxi-overtake", start: 5_650, duration: 1_100 },
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const progress = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function hashInteger(value: number): number {
  let next = value | 0;
  next = Math.imul(next ^ (next >>> 16), 0x45d9f3b);
  next = Math.imul(next ^ (next >>> 16), 0x45d9f3b);
  return (next ^ (next >>> 16)) >>> 0;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function directorIntensity(localMeters: number): number {
  if (localMeters < 1_250) {
    return 0.18 + smoothstep(0, 1_250, localMeters) * 0.14;
  }
  if (localMeters < 3_050) {
    return 0.32 + smoothstep(1_250, 3_050, localMeters) * 0.5;
  }
  if (localMeters < 5_050) {
    return 0.82 + smoothstep(3_050, 5_050, localMeters) * 0.18;
  }
  return 1 - smoothstep(5_050, DRIVE_DIRECTOR_CYCLE_METERS, localMeters) * 0.82;
}

function directorMood(localMeters: number): DriveMood {
  if (localMeters < 1_250) return "quiet";
  if (localMeters < 3_050) return "rising";
  if (localMeters < 5_050) return "peak";
  return "afterglow";
}

export function sampleDriveDirector(
  journeyDistanceMeters: number,
  sessionSeed: number,
): DriveDirectorState {
  const safeDistance = Math.max(0, journeyDistanceMeters);
  const cycleIndex = Math.floor(safeDistance / DRIVE_DIRECTOR_CYCLE_METERS);
  const localMeters = positiveModulo(
    safeDistance,
    DRIVE_DIRECTOR_CYCLE_METERS,
  );
  const slot = EVENT_SLOTS.find(
    (candidate) =>
      localMeters >= candidate.start &&
      localMeters < candidate.start + candidate.duration,
  );
  const event = slot
    ? (() => {
        const eventHash = hashInteger(
          sessionSeed + cycleIndex * 31 + slot.start,
        );
        return {
          kind: slot.kind,
          progressMeters: localMeters - slot.start,
          durationMeters: slot.duration,
          side: (eventHash & 1)
            ? (1 as const)
            : (-1 as const),
          variant: ((eventHash >>> 1) % 3) as 0 | 1 | 2,
        };
      })()
    : null;

  return {
    intensity: directorIntensity(localMeters),
    mood: directorMood(localMeters),
    cycleProgress: localMeters / DRIVE_DIRECTOR_CYCLE_METERS,
    event,
  };
}
