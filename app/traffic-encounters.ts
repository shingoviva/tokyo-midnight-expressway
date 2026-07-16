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

const VEHICLE_LENGTH_METERS: Readonly<Record<OvertakeTrafficKind, number>> = {
  sedan: 4.55,
  minivan: 4.9,
  truck: 8.35,
};

export const OVERTAKE_LANE_OFFSET_METERS = 1.72;

const PASSING_MANEUVER_TRIGGER_METERS = 145;
const PASSING_LANE_REAR_CLEARANCE_METERS = 24;
const PASSING_LANE_FORWARD_CLEARANCE_METERS = 72;
const ROAD_OBSTACLE_TRIGGER_METERS = 145;
const AVOIDANCE_LANE_REAR_CLEARANCE_METERS = 24;
const AVOIDANCE_LANE_FORWARD_CLEARANCE_METERS = 58;

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

function overlapsVehicleCorridor(
  laneLateral: number,
  movingKind: OvertakeTrafficKind,
  vehicleLateral: number,
  vehicleKind: OvertakeTrafficKind,
  paddingMeters: number,
): boolean {
  const movingHalfWidth = VEHICLE_WIDTH_METERS[movingKind] * 0.5;
  const vehicleHalfWidth = VEHICLE_WIDTH_METERS[vehicleKind] * 0.5;
  return Math.abs(vehicleLateral - laneLateral) <
    movingHalfWidth + vehicleHalfWidth + paddingMeters;
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
      overlapsVehicleCorridor(
        currentLaneLateral,
        "sedan",
        vehicle.lateral,
        vehicle.kind,
        0.3,
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
      !overlapsVehicleCorridor(
        passingLaneLateral,
        "sedan",
        vehicle.lateral,
        vehicle.kind,
        0.3,
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

export function roadObstacleRequiresAvoidance(
  vehicleZ: number,
  vehicleLateral: number,
  vehicleKind: OvertakeTrafficKind,
  obstacleZ: number,
  obstacleLateral: number,
  obstacleKind: OvertakeTrafficKind,
): boolean {
  const forwardGap = obstacleZ - vehicleZ;
  return (
    forwardGap > 0 &&
    forwardGap <= ROAD_OBSTACLE_TRIGGER_METERS &&
    overlapsVehicleCorridor(
      vehicleLateral,
      vehicleKind,
      obstacleLateral,
      obstacleKind,
      0.42,
    )
  );
}

/**
 * Keeps a traffic vehicle behind a stopped or merging road object while the
 * adjacent lane is unavailable or the lane change is still in progress.
 * Vehicle centres are separated by their physical half-lengths plus a small
 * night-driving buffer, so the silhouettes cannot intersect in projection.
 */
export function safeRoadObstacleFollowingZ(
  vehicleZ: number,
  vehicleLateral: number,
  vehicleKind: OvertakeTrafficKind,
  obstacleZ: number,
  obstacleLateral: number,
  obstacleKind: OvertakeTrafficKind,
): number {
  if (
    !Number.isFinite(vehicleZ) ||
    !Number.isFinite(obstacleZ) ||
    obstacleZ < vehicleZ
  ) {
    return vehicleZ;
  }
  if (
    !overlapsVehicleCorridor(
      vehicleLateral,
      vehicleKind,
      obstacleLateral,
      obstacleKind,
      0.24,
    )
  ) {
    return vehicleZ;
  }

  const followingDistance =
    VEHICLE_LENGTH_METERS[vehicleKind] * 0.5 +
    VEHICLE_LENGTH_METERS[obstacleKind] * 0.5 +
    4.2;
  return Math.min(vehicleZ, obstacleZ - followingDistance);
}

export function avoidanceLaneBlockedByVehicle(
  vehicleZ: number,
  targetLaneLateral: number,
  vehicleKind: OvertakeTrafficKind,
  otherZ: number,
  otherLateral: number,
  otherKind: OvertakeTrafficKind,
): boolean {
  if (
    !overlapsVehicleCorridor(
      targetLaneLateral,
      vehicleKind,
      otherLateral,
      otherKind,
      0.34,
    )
  ) {
    return false;
  }
  const relativeZ = otherZ - vehicleZ;
  return (
    relativeZ >= -AVOIDANCE_LANE_REAR_CLEARANCE_METERS &&
    relativeZ <= AVOIDANCE_LANE_FORWARD_CLEARANCE_METERS
  );
}

export function smoothPassingLateral(
  fromLateral: number,
  toLateral: number,
  progress: number,
): number {
  const normalizedProgress = Math.max(0, Math.min(1, progress));
  const easedProgress =
    normalizedProgress *
    normalizedProgress *
    normalizedProgress *
    (normalizedProgress * (normalizedProgress * 6 - 15) + 10);
  return fromLateral + (toLateral - fromLateral) * easedProgress;
}

export function advancePassingLateral(
  currentLateral: number,
  currentVelocity: number,
  targetLateral: number,
  deltaSeconds: number,
): Readonly<{ lateral: number; velocity: number }> {
  const safeDeltaSeconds = Math.max(0, Math.min(0.05, deltaSeconds));
  const remaining = targetLateral - currentLateral;
  if (Math.abs(remaining) < 0.012 && Math.abs(currentVelocity) < 0.025) {
    return { lateral: targetLateral, velocity: 0 };
  }

  const desiredAcceleration = remaining * 0.95 - currentVelocity * 1.55;
  const acceleration = Math.max(-0.92, Math.min(0.92, desiredAcceleration));
  const nextVelocity = Math.max(
    -1.02,
    Math.min(1.02, currentVelocity + acceleration * safeDeltaSeconds),
  );
  const nextLateral = currentLateral + nextVelocity * safeDeltaSeconds;
  if (
    (remaining > 0 && nextLateral >= targetLateral) ||
    (remaining < 0 && nextLateral <= targetLateral)
  ) {
    return { lateral: targetLateral, velocity: 0 };
  }
  return { lateral: nextLateral, velocity: nextVelocity };
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

export function advanceOvertakeMotion(
  currentZ: number,
  currentVelocity: number,
  targetZ: number,
  deltaSeconds: number,
): Readonly<{ z: number; velocity: number }> {
  const safeDeltaSeconds = Math.max(0, Math.min(0.05, deltaSeconds));
  const remaining = targetZ - currentZ;
  if (Math.abs(remaining) < 0.015 && Math.abs(currentVelocity) < 0.04) {
    return { z: targetZ, velocity: 0 };
  }

  const desiredVelocity = Math.max(-3.2, Math.min(9.2, remaining * 0.38));
  const accelerationLimit = desiredVelocity >= currentVelocity ? 2.8 : 3.5;
  const velocityDifference = desiredVelocity - currentVelocity;
  const maximumVelocityStep = accelerationLimit * safeDeltaSeconds;
  const nextVelocity = currentVelocity + Math.max(
    -maximumVelocityStep,
    Math.min(maximumVelocityStep, velocityDifference),
  );
  const nextZ = currentZ + nextVelocity * safeDeltaSeconds;
  if (
    (remaining > 0 && nextZ >= targetZ) ||
    (remaining < 0 && nextZ <= targetZ)
  ) {
    return { z: targetZ, velocity: 0 };
  }
  return { z: Math.max(0.05, nextZ), velocity: nextVelocity };
}
