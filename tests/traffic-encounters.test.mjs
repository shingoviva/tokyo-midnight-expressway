import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceOvertakePosition,
  safeOvertakeTargetZ,
} from "../app/traffic-encounters.ts";

test("an overtaking taxi stays behind the first vehicle in its corridor", () => {
  const target = safeOvertakeTargetZ(120, 1.72, [
    { z: 82, lateral: 1.72, kind: "sedan" },
    { z: 140, lateral: 1.72, kind: "truck" },
  ]);
  assert.equal(target, 74);
});

test("adjacent-lane traffic does not unnecessarily stop the taxi", () => {
  const target = safeOvertakeTargetZ(120, 1.72, [
    { z: 42, lateral: -1.72, kind: "truck" },
  ]);
  assert.equal(target, 120);
});

test("a vehicle changing across the lane blocks both bodies from overlapping", () => {
  const target = safeOvertakeTargetZ(80, 1.58, [
    { z: 55, lateral: 0, kind: "truck" },
  ]);
  assert.equal(target, 42);
});

test("the taxi enters and releases from traffic limits without position jumps", () => {
  assert.ok(Math.abs(advanceOvertakePosition(0.05, 50, 0.05) - 0.7) < 1e-9);
  assert.ok(Math.abs(advanceOvertakePosition(20, 4, 0.05) - 19.1) < 1e-9);
  assert.equal(advanceOvertakePosition(5, 5.2, 0.05), 5.2);
});
