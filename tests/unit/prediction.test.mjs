import test from "node:test";
import assert from "node:assert/strict";
import { formScore, predictMatch } from "../../lib/prediction-engine.mjs";
import { matchups } from "../../lib/demo-data.mjs";

test("recent results receive greater weight", () => {
  assert.ok(formScore(["L", "L", "L", "L", "W"]) > formScore(["W", "L", "L", "L", "L"]));
});

test("soccer probabilities sum to 100 within rounding tolerance", () => {
  const result = predictMatch(matchups.find((m) => m.sport === "soccer"));
  assert.ok(Math.abs(result.home + result.draw + result.away - 100) <= 0.2);
  assert.ok(result.btts >= 0 && result.btts <= 100);
  assert.ok(result.over25 >= 0 && result.over25 <= 100);
});

test("basketball produces two-way probabilities and a total", () => {
  const result = predictMatch(matchups.find((m) => m.sport === "basketball"));
  assert.equal(result.draw, 0);
  assert.equal(result.home + result.away, 100);
  assert.ok(result.total > 100);
});
