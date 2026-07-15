function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function roadsideSoundBarrierHeight(
  world: number,
  side: -1 | 1,
  locationLength: number,
  locationCount: number,
): number {
  const location = positiveModulo(
    Math.floor(world / locationLength),
    locationCount,
  );
  const local = positiveModulo(world, locationLength);
  if (location !== 2 && location !== 12) return 0;
  if (side > 0 && local >= 430) return 0;
  return side < 0 ? 3.55 : 3.05;
}

export function isRoadsideSignBlockedByTallWall(
  world: number,
  side: -1 | 1,
  locationLength: number,
  locationCount: number,
): boolean {
  // Keep a short longitudinal buffer around wall transitions so a wide board
  // cannot straddle the start or end of a sound-barrier run in perspective.
  return [-18, 0, 18].some(
    (offset) =>
      roadsideSoundBarrierHeight(
        world + offset,
        side,
        locationLength,
        locationCount,
      ) > 1.4,
  );
}
