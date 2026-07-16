import assert from "node:assert/strict";
import test from "node:test";
import {
  advancePassingLateral,
  advanceOvertakeMotion,
  advanceOvertakePosition,
  avoidanceLaneBlockedByVehicle,
  roadObstacleRequiresAvoidance,
  safeRoadObstacleFollowingZ,
  safeOvertakeTargetZ,
  selectPassingLane,
  smoothPassingLateral,
} from "../app/traffic-encounters.ts";

test("an overtaking taxi stays behind the first vehicle in its corridor", () => {
  const target = safeOvertakeTargetZ(120, 20, 1.72, [
    { z: 82, lateral: 1.72, kind: "sedan" },
    { z: 140, lateral: 1.72, kind: "truck" },
  ]);
  assert.equal(target, 74);
});

test("adjacent-lane traffic does not unnecessarily stop the taxi", () => {
  const target = safeOvertakeTargetZ(120, 20, 1.72, [
    { z: 42, lateral: -1.72, kind: "truck" },
  ]);
  assert.equal(target, 120);
});

test("a vehicle changing across the lane blocks both bodies from overlapping", () => {
  const target = safeOvertakeTargetZ(80, 20, 1.58, [
    { z: 55, lateral: 0, kind: "truck" },
  ]);
  assert.equal(target, 42);
});

test("a vehicle already passed by the taxi cannot pull it backwards", () => {
  const target = safeOvertakeTargetZ(140, 90, 1.72, [
    { z: 74, lateral: 1.72, kind: "truck" },
  ]);
  assert.equal(target, 140);
});

test("the taxi selects a clear adjacent lane before reaching slower traffic", () => {
  const lane = selectPassingLane(20, 1.72, [
    { z: 76, lateral: 1.72, kind: "sedan" },
    { z: 130, lateral: -1.72, kind: "truck" },
  ]);
  assert.equal(lane, -1.72);
});

test("the taxi waits to change lanes while a vehicle is alongside", () => {
  const lane = selectPassingLane(20, 1.72, [
    { z: 76, lateral: 1.72, kind: "sedan" },
    { z: 27, lateral: -1.72, kind: "truck" },
  ]);
  assert.equal(lane, 1.72);
});

test("passing lane movement has eased endpoints", () => {
  assert.equal(smoothPassingLateral(1.72, -1.72, 0), 1.72);
  assert.equal(smoothPassingLateral(1.72, -1.72, 1), -1.72);
  assert.equal(smoothPassingLateral(1.72, -1.72, 0.5), 0);
});

test("overtaking steering accelerates and settles without overshoot", () => {
  let state = { lateral: 1.72, velocity: 0 };
  const first = advancePassingLateral(
    state.lateral,
    state.velocity,
    -1.72,
    1 / 60,
  );
  const second = advancePassingLateral(
    first.lateral,
    first.velocity,
    -1.72,
    1 / 60,
  );
  assert.ok(Math.abs(second.velocity) > Math.abs(first.velocity));

  state = second;
  for (let frame = 0; frame < 420; frame += 1) {
    state = advancePassingLateral(
      state.lateral,
      state.velocity,
      -1.72,
      1 / 60,
    );
    assert.ok(state.lateral >= -1.72);
  }
  assert.ok(Math.abs(state.lateral + 1.72) < 0.02);
  assert.ok(Math.abs(state.velocity) < 0.04);
});

test("a moving vehicle identifies a stopped truck in its lane early", () => {
  assert.equal(
    roadObstacleRequiresAvoidance(
      120,
      1.72,
      "sedan",
      238,
      1.72,
      "truck",
    ),
    true,
  );
  assert.equal(
    roadObstacleRequiresAvoidance(
      120,
      -1.72,
      "sedan",
      238,
      1.72,
      "truck",
    ),
    false,
  );
});

test("a stopped object behind the moving vehicle does not trigger avoidance", () => {
  assert.equal(
    roadObstacleRequiresAvoidance(
      238,
      1.72,
      "minivan",
      120,
      1.72,
      "truck",
    ),
    false,
  );
});

test("a general traffic car is held behind a stopped truck", () => {
  assert.equal(
    safeRoadObstacleFollowingZ(
      120,
      1.72,
      "sedan",
      128,
      1.72,
      "truck",
    ),
    117.35,
  );
  assert.equal(
    safeRoadObstacleFollowingZ(
      120,
      -1.72,
      "sedan",
      128,
      1.72,
      "truck",
    ),
    120,
  );
});

test("a stopped truck cannot sweep through traffic while the other lane is blocked", () => {
  let vehicleZ = 120;
  for (let obstacleZ = 170; obstacleZ >= 12; obstacleZ -= 0.65) {
    vehicleZ -= 0.025;
    vehicleZ = safeRoadObstacleFollowingZ(
      vehicleZ,
      1.72,
      "minivan",
      obstacleZ,
      1.72,
      "truck",
    );
    if (obstacleZ > vehicleZ) {
      assert.ok(obstacleZ - vehicleZ >= 10.825 - 1e-9);
    }
  }
});

test("two traffic vehicles cannot remain at the same longitudinal position", () => {
  assert.equal(
    safeRoadObstacleFollowingZ(
      80,
      -1.72,
      "sedan",
      80,
      -1.72,
      "minivan",
    ),
    71.075,
  );
});

test("avoidance waits while another vehicle occupies the destination lane", () => {
  assert.equal(
    avoidanceLaneBlockedByVehicle(
      120,
      -1.72,
      "sedan",
      150,
      -1.72,
      "minivan",
    ),
    true,
  );
  assert.equal(
    avoidanceLaneBlockedByVehicle(
      120,
      -1.72,
      "sedan",
      150,
      1.72,
      "minivan",
    ),
    false,
  );
});

test("the taxi enters and releases from traffic limits without position jumps", () => {
  assert.ok(Math.abs(advanceOvertakePosition(0.05, 50, 0.05) - 0.7) < 1e-9);
  assert.ok(Math.abs(advanceOvertakePosition(20, 4, 0.05) - 19.8) < 1e-9);
  assert.equal(advanceOvertakePosition(5, 5.2, 0.05), 5.2);
});

test("the overtaking taxi accelerates longitudinally instead of jumping away", () => {
  let state = { z: 0.05, velocity: 0 };
  for (let frame = 0; frame < 60; frame += 1) {
    state = advanceOvertakeMotion(
      state.z,
      state.velocity,
      120,
      1 / 60,
    );
  }
  assert.ok(state.velocity > 2.6 && state.velocity < 3);
  assert.ok(state.z > 1.3 && state.z < 1.6);

  for (let frame = 0; frame < 300; frame += 1) {
    state = advanceOvertakeMotion(
      state.z,
      state.velocity,
      120,
      1 / 60,
    );
  }
  assert.ok(state.velocity <= 9.2);
  assert.ok(state.z < 50);
});
