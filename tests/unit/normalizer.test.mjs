import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOpenFootballRound } from "../../lib/prediction-engine.mjs";

test("OpenFootball rounds normalize into the internal match schema", () => {
  const output = normalizeOpenFootballRound({ rounds: [{ matches: [{ date: "2026-09-10", team1: { name: "Alpha" }, team2: { name: "Beta" }, score: { ft: [2, 1] } }] }] }, "Test League");
  assert.deepEqual(output[0], { externalId: "Test League-0", league: "Test League", date: "2026-09-10", homeTeam: "Alpha", awayTeam: "Beta", homeScore: 2, awayScore: 1 });
});
