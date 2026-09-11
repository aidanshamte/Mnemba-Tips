import test from "node:test";
import assert from "node:assert/strict";
import { matchups } from "../../lib/demo-data.mjs";
import { predictMatch, projectLineup } from "../../lib/prediction-engine.mjs";

test("every configured matchup completes the prediction workflow", () => {
  for (const match of matchups) {
    const prediction = predictMatch(match);
    const expectedSize = match.sport === "soccer" ? 11 : 5;
    assert.match(prediction.projectedScore, /^\d+–\d+$/);
    assert.equal(projectLineup(match.home.players, match.sport).length, expectedSize);
    assert.equal(projectLineup(match.away.players, match.sport).length, expectedSize);
    assert.ok(prediction.confidence >= 0 && prediction.confidence <= 100);
    assert.equal(prediction.reasons.length, 3);
  }
});

test("catalog has working coverage for both sports", () => {
  assert.ok(matchups.some((m) => m.sport === "soccer"));
  assert.ok(matchups.some((m) => m.sport === "basketball"));
});
