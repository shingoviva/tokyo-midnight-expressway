import assert from "node:assert/strict";
import test from "node:test";
import {
  isRoadsideSignBlockedByTallWall,
  roadsideSoundBarrierHeight,
} from "../app/roadside-layout.ts";

const LOCATION_LENGTH = 700;
const LOCATION_COUNT = 14;

function soundBarrierHeightAt(world, side) {
  return roadsideSoundBarrierHeight(
    world,
    side,
    LOCATION_LENGTH,
    LOCATION_COUNT,
  );
}

function roadsideSignBlockedByTallWall(world, side) {
  return isRoadsideSignBlockedByTallWall(
    world,
    side,
    LOCATION_LENGTH,
    LOCATION_COUNT,
  );
}

test("roadside signs are suppressed on the occupied side of sound walls", () => {
  assert.equal(soundBarrierHeightAt(1_500, -1), 3.55);
  assert.equal(soundBarrierHeightAt(1_500, 1), 3.05);
  assert.equal(soundBarrierHeightAt(1_950, -1), 3.55);
  assert.equal(soundBarrierHeightAt(1_950, 1), 0);

  assert.equal(roadsideSignBlockedByTallWall(1_500, -1), true);
  assert.equal(roadsideSignBlockedByTallWall(1_500, 1), true);
  assert.equal(roadsideSignBlockedByTallWall(1_950, -1), true);
  assert.equal(roadsideSignBlockedByTallWall(1_950, 1), false);
  assert.equal(roadsideSignBlockedByTallWall(2_180, -1), false);
});

test("the same wall clearance repeats with the procedural scene cycle", () => {
  assert.equal(roadsideSignBlockedByTallWall(8_500, -1), true);
  assert.equal(roadsideSignBlockedByTallWall(8_500, 1), true);
  assert.equal(roadsideSignBlockedByTallWall(9_040, 1), false);
});
