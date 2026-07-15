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

const LONGITUDINAL_CLEARANCE_METERS: Readonly<
  Record<OvertakeTrafficKind, number>
> = {
  sedan: 8,
  minivan: 9,
  truck: 13,
};

export function safeOvertakeTargetZ(
  desiredZ: number,
  taxiLateral: number,
  traffic: readonly OvertakeTrafficSample[],
): number {
  let safeZ = desiredZ;
  for (const vehicle of traffic) {
    safeZ = safeOvertakeTargetAgainstVehicle(
      safeZ,
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
  taxiLateral: number,
  vehicleZ: number,
  vehicleLateral: number,
  vehicleKind: OvertakeTrafficKind,
): number {
  const taxiHalfWidth = VEHICLE_WIDTH_METERS.sedan * 0.5;
  if (!Number.isFinite(vehicleZ) || vehicleZ <= 0.12) return currentTargetZ;
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

export function advanceOvertakePosition(
  currentZ: number,
  targetZ: number,
  deltaSeconds: number,
): number {
  const safeDeltaSeconds = Math.max(0, Math.min(0.05, deltaSeconds));
  const maximumRate = targetZ >= currentZ ? 13 : 18;
  const maximumStep = maximumRate * safeDeltaSeconds;
  const difference = targetZ - currentZ;
  if (Math.abs(difference) <= maximumStep) return targetZ;
  return currentZ + Math.sign(difference) * maximumStep;
}
