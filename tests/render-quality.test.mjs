import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptiveMobilePixelRatio,
  RENDER_QUALITY_PROFILES,
  renderPixelRatio,
  selectRenderQuality,
  signMipmapLevel,
} from "../app/render-quality.ts";

test("coarse-pointer phones always use the mobile renderer", () => {
  assert.equal(selectRenderQuality(1_179, true), "MOBILE");
  assert.equal(selectRenderQuality(390, false), "MOBILE");
  assert.equal(selectRenderQuality(1_440, false), "HIGH");
});

test("mobile rendering limits both pixels and expensive effects", () => {
  const profile = RENDER_QUALITY_PROFILES.MOBILE;
  assert.equal(renderPixelRatio(390, 844, 3, "MOBILE"), 0.9);
  assert.equal(renderPixelRatio(1_179, 2_556, 3, "MOBILE"), 0.7);
  assert.ok(profile.glowRatio < RENDER_QUALITY_PROFILES.HIGH.glowRatio);
  assert.ok(profile.vehicleCount < RENDER_QUALITY_PROFILES.HIGH.vehicleCount);
  assert.equal(profile.buildingSpacing, 92);
  assert.equal(profile.buildingWindowRows, 7);
  assert.equal(profile.buildingWindowColumns, 4);
  assert.equal(profile.buildingWindowLitBias, -0.045);
  assert.equal(profile.buildingFacadeLightLift, 4);
  assert.equal(profile.vehicleCount, 8);
  assert.equal(profile.noiseEnabled, false);
  assert.equal(profile.minimumFrameIntervalMs, 1000 / 60);
  assert.equal(profile.bloomEnabled, false);
});

test("mobile resolution responds slowly to headroom and quickly to pressure", () => {
  assert.equal(adaptiveMobilePixelRatio(0.9, 0.9, 48, 12, 0), 0.85);
  assert.equal(adaptiveMobilePixelRatio(0.7, 0.9, 48, 16, 0), 0.7);
  assert.equal(adaptiveMobilePixelRatio(0.75, 0.9, 60, 8, 2), 0.75);
  assert.equal(adaptiveMobilePixelRatio(0.75, 0.9, 60, 8, 3), 0.8);
  assert.equal(adaptiveMobilePixelRatio(0.9, 0.9, 60, 8, 4), 0.9);
});

test("distant signs always downsample from a larger mipmap", () => {
  assert.equal(signMipmapLevel(10, 7), 5);
  assert.equal(signMipmapLevel(24, 7), 4);
  assert.equal(signMipmapLevel(220, 7), 1);
  assert.equal(signMipmapLevel(900, 7), 0);
});

test("desktop quality budgets remain unchanged", () => {
  assert.equal(RENDER_QUALITY_PROFILES.HIGH.ratioCap, 1.65);
  assert.equal(RENDER_QUALITY_PROFILES.HIGH.pixelBudget, 5_200_000);
  assert.equal(RENDER_QUALITY_PROFILES.HIGH.buildingSpacing, 35);
  assert.equal(RENDER_QUALITY_PROFILES.HIGH.buildingWindowLitBias, 0);
  assert.equal(RENDER_QUALITY_PROFILES.HIGH.buildingFacadeLightLift, 0);
  assert.equal(RENDER_QUALITY_PROFILES.HIGH.minimumFrameIntervalMs, 0);
  assert.equal(RENDER_QUALITY_PROFILES.HIGH.bloomEnabled, true);
  assert.equal(RENDER_QUALITY_PROFILES.BALANCED.ratioCap, 1.45);
  assert.equal(RENDER_QUALITY_PROFILES.BALANCED.pixelBudget, 3_600_000);
});
