export type OvertakeTrafficKind = "sedan" | "minivan" | "truck";

export type OvertakeTrafficSample = Readonly<{
  z: number;
  lateral: number;
  kind: OvertakeTrafficKind;
}>;

const VEHICLE_WIDTH_METERS: Readonly<Record<OvertakeTrafficKind, number>> = {
  sedan: 1.82,
  minivan: 1.9,
  truck: 2.42,
};

export const OVERTAKE_LANE_OFFSET_METERS = 1.72;

const PASSING_MANEUVER_TRIGGER_METERS = 92;
const PASSING_LANE_REAR_CLEARANCE_METERS = 18;
const PASSING_LANE_FORWARD_CLEARANCE_METERS = 48;

const LONGITUDINAL_CLEARANCE_METERS: Readonly<
  Record<OvertakeTrafficKind, number>
> = {
  sedan: 8,
  minivan: 9,
  truck: 13,
};

export function safeOvertakeTargetZ(
  desiredZ: number,
  taxiZ: number,
  taxiLateral: number,
  traffic: readonly OvertakeTrafficSample[],
): number {
  let safeZ = desiredZ;
  for (const vehicle of traffic) {
    safeZ = safeOvertakeTargetAgainstVehicle(
      safeZ,
      taxiZ,
      taxiLateral,
      vehicle.z,
      vehicle.lateral,
      vehicle.kind,
    );
  }
  return safeZ;
}

export function safeOvertakeTargetAgainstVehicle(
  currentTargetZ: number,
  taxiZ: number,
  taxiLateral: number,
  vehicleZ: number,
  vehicleLateral: number,
  vehicleKind: OvertakeTrafficKind,
): number {
  const taxiHalfWidth = VEHICLE_WIDTH_METERS.sedan * 0.5;
  if (
    !Number.isFinite(vehicleZ) ||
    vehicleZ <= 0.12 ||
    vehicleZ <= taxiZ
  ) {
    return currentTargetZ;
  }
  const lateralClearance =
    taxiHalfWidth + VEHICLE_WIDTH_METERS[vehicleKind] * 0.5 + 0.25;
  if (Math.abs(vehicleLateral - taxiLateral) >= lateralClearance) {
    return currentTargetZ;
  }
  return Math.max(
    0.05,
    Math.min(
      currentTargetZ,
      vehicleZ - LONGITUDINAL_CLEARANCE_METERS[vehicleKind],
    ),
  );
}

function overlapsLaneCorridor(
  laneLateral: number,
  vehicleLateral: number,
  vehicleKind: OvertakeTrafficKind,
): boolean {
  const taxiHalfWidth = VEHICLE_WIDTH_METERS.sedan * 0.5;
  const vehicleHalfWidth = VEHICLE_WIDTH_METERS[vehicleKind] * 0.5;
  return Math.abs(vehicleLateral - laneLateral) <
    taxiHalfWidth + vehicleHalfWidth + 0.3;
}

/**
 * Chooses the other carriageway lane before the taxi reaches slower traffic.
 * The target lane is accepted only when there is enough room alongside and
 * immediately ahead of the taxi for the whole lane-change envelope.
 */
export function selectPassingLane(
  taxiZ: number,
  currentLaneLateral: number,
  traffic: readonly OvertakeTrafficSample[],
): number {
  const blockingVehicleAhead = traffic.some((vehicle) => {
    const forwardGap = vehicle.z - taxiZ;
    return (
      forwardGap > 0 &&
      forwardGap <= PASSING_MANEUVER_TRIGGER_METERS &&
      overlapsLaneCorridor(
        currentLaneLateral,
        vehicle.lateral,
        vehicle.kind,
      )
    );
  });
  if (!blockingVehicleAhead) return currentLaneLateral;

  const passingLaneLateral =
    currentLaneLateral >= 0
      ? -OVERTAKE_LANE_OFFSET_METERS
      : OVERTAKE_LANE_OFFSET_METERS;
  const passingLaneBlocked = traffic.some((vehicle) => {
    if (
      !overlapsLaneCorridor(
        passingLaneLateral,
        vehicle.lateral,
        vehicle.kind,
      )
    ) {
      return false;
    }
    const relativeZ = vehicle.z - taxiZ;
    return (
      relativeZ >= -PASSING_LANE_REAR_CLEARANCE_METERS &&
      relativeZ <= PASSING_LANE_FORWARD_CLEARANCE_METERS
    );
  });

  return passingLaneBlocked ? currentLaneLateral : passingLaneLateral;
}

export function smoothPassingLateral(
  fromLateral: number,
  toLateral: number,
  progress: number,
): number {
  const normalizedProgress = Math.max(0, Math.min(1, progress));
  const easedProgress =
    normalizedProgress * normalizedProgress * (3 - 2 * normalizedProgress);
  return fromLateral + (toLateral - fromLateral) * easedProgress;
}

export function advanceOvertakePosition(
  currentZ: number,
  targetZ: number,
  deltaSeconds: number,
): number {
  const safeDeltaSeconds = Math.max(0, Math.min(0.05, deltaSeconds));
  // A defensive longitudinal correction should read as a gentle lift-off,
  // never as the abrupt braking that the previous high reverse rate caused.
  const maximumRate = targetZ >= currentZ ? 13 : 4;
  const maximumStep = maximumRate * safeDeltaSeconds;
  const difference = targetZ - currentZ;
  if (Math.abs(difference) <= maximumStep) return targetZ;
  return currentZ + Math.sign(difference) * maximumStep;
}
