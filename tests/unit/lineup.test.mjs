import test from "node:test";
import assert from "node:assert/strict";
import { projectLineup } from "../../lib/prediction-engine.mjs";
import { matchups } from "../../lib/demo-data.mjs";

test("soccer lineup contains eleven eligible players with positional coverage", () => {
  const team = matchups.find((m) => m.sport === "soccer").home;
  const lineup = projectLineup(team.players, "soccer");
  assert.equal(lineup.length, 11);
  assert.equal(lineup.filter((p) => p.position === "GK").length, 1);
  assert.ok(lineup.every((p) => p.status !== "unavailable"));
});

test("basketball lineup contains five eligible starters", () => {
  const team = matchups.find((m) => m.sport === "basketball").home;
  const lineup = projectLineup(team.players, "basketball");
  assert.equal(lineup.length, 5);
  assert.ok(lineup.every((p) => p.status !== "unavailable"));
});
