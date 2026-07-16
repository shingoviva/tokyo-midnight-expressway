import assert from "node:assert/strict";
import test from "node:test";
import { transverseOverpassPierLaterals } from "../app/overpass-layout.ts";
import {
  rainbowBridgeHasVisibleRunout,
  rainbowBridgeRenderDepth,
} from "../app/procedural-landmarks.ts";

test("Rainbow Bridge remains until its complete exit runout passes", () => {
  assert.equal(rainbowBridgeHasVisibleRunout(-900), true);
  assert.equal(rainbowBridgeHasVisibleRunout(-1_039.8), true);
  assert.equal(rainbowBridgeHasVisibleRunout(-1_040), false);
  assert.equal(rainbowBridgeRenderDepth(380), 380);
  assert.equal(rainbowBridgeRenderDepth(-900), 0.12);
});

test("transverse highways use multiple symmetric pier pairs", () => {
  const mobile = transverseOverpassPierLaterals(0, "MOBILE");
  const balanced = transverseOverpassPierLaterals(1, "BALANCED");
  const high = transverseOverpassPierLaterals(2, "HIGH");

  assert.equal(mobile.length, 4);
  assert.equal(balanced.length, 6);
  assert.equal(high.length, 8);
  for (const layout of [mobile, balanced, high]) {
    assert.ok(layout.every((lateral) => Math.abs(lateral) > 10));
    assert.deepEqual(layout, [...layout].sort((a, b) => a - b));
    assert.deepEqual(
      layout,
      [...layout].reverse().map((lateral) => -lateral),
    );
  }
});
