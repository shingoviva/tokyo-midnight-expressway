import assert from "node:assert/strict";
import test from "node:test";
import {
  RENDER_QUALITY_PROFILES,
  renderPixelRatio,
  selectRenderQuality,
} from "../app/render-quality.ts";

test("coarse-pointer phones always use the mobile renderer", () => {
  assert.equal(selectRenderQuality(1_179, true), "MOBILE");
  assert.equal(selectRenderQuality(390, false), "MOBILE");
  assert.equal(selectRenderQuality(1_440, false), "HIGH");
});

test("mobile rendering limits both pixels and expensive effects", () => {
  const profile = RENDER_QUALITY_PROFILES.MOBILE;
  assert.equal(renderPixelRatio(390, 844, 3, "MOBILE"), 0.78);
  assert.equal(renderPixelRatio(1_179, 2_556, 3, "MOBILE"), 0.62);
  assert.ok(profile.glowRatio < RENDER_QUALITY_PROFILES.HIGH.glowRatio);
  assert.ok(profile.vehicleCount < RENDER_QUALITY_PROFILES.HIGH.vehicleCount);
  assert.equal(profile.noiseEnabled, false);
  assert.equal(profile.minimumFrameIntervalMs, 1000 / 30);
});

test("desktop quality budgets remain unchanged", () => {
  assert.equal(RENDER_QUALITY_PROFILES.HIGH.ratioCap, 1.65);
  assert.equal(RENDER_QUALITY_PROFILES.HIGH.pixelBudget, 5_200_000);
  assert.equal(RENDER_QUALITY_PROFILES.HIGH.buildingSpacing, 35);
  assert.equal(RENDER_QUALITY_PROFILES.HIGH.minimumFrameIntervalMs, 0);
  assert.equal(RENDER_QUALITY_PROFILES.BALANCED.ratioCap, 1.45);
  assert.equal(RENDER_QUALITY_PROFILES.BALANCED.pixelBudget, 3_600_000);
});
