import assert from "node:assert/strict";
import test from "node:test";
import {
  DRIVE_DIRECTOR_CYCLE_METERS,
  sampleDriveDirector,
} from "../app/drive-director.ts";

test("drive director moves through quiet, rising, peak, and afterglow", () => {
  const quiet = sampleDriveDirector(0, 42);
  const rising = sampleDriveDirector(2_000, 42);
  const peak = sampleDriveDirector(4_000, 42);
  const afterglow = sampleDriveDirector(6_400, 42);

  assert.equal(quiet.mood, "quiet");
  assert.equal(rising.mood, "rising");
  assert.equal(peak.mood, "peak");
  assert.equal(afterglow.mood, "afterglow");
  assert.ok(quiet.intensity < rising.intensity);
  assert.ok(rising.intensity < peak.intensity);
  assert.ok(afterglow.intensity < peak.intensity);
});

test("scripted encounters occupy separated windows and repeat safely", () => {
  assert.equal(sampleDriveDirector(0, 99).event, null);
  assert.equal(sampleDriveDirector(400, 99).event?.kind, "taxi-overtake");
  assert.equal(sampleDriveDirector(2_420, 99).event?.kind, "truck-merge");
  assert.equal(sampleDriveDirector(4_180, 99).event?.kind, "maintenance-run");
  assert.equal(sampleDriveDirector(5_650, 99).event?.kind, "taxi-overtake");
  assert.equal(sampleDriveDirector(6_900, 99).event, null);
  assert.equal(
    sampleDriveDirector(DRIVE_DIRECTOR_CYCLE_METERS + 400, 99).event?.kind,
    "taxi-overtake",
  );
});

test("repeated encounters receive deterministic movement variants", () => {
  const variants = new Set();
  for (let cycle = 0; cycle < 8; cycle += 1) {
    const event = sampleDriveDirector(
      cycle * DRIVE_DIRECTOR_CYCLE_METERS + 400,
      99,
    ).event;
    assert.equal(event?.kind, "taxi-overtake");
    assert.ok(event.variant >= 0 && event.variant <= 2);
    variants.add(event.variant);
  }
  assert.ok(variants.size > 1);
});
