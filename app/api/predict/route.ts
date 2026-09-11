import { matchups } from "@/lib/demo-data.mjs";
import { predictMatch, projectLineup } from "@/lib/prediction-engine.mjs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { matchupId?: string } | null;
  const match: any = matchups.find((candidate: any) => candidate.id === body?.matchupId);
  if (!match) return Response.json({ error: "Unknown matchupId" }, { status: 404 });
  return Response.json({
    matchupId: match.id,
    generatedAt: new Date().toISOString(),
    modelVersion: "pitchpredict-v3",
    prediction: predictMatch(match),
    projectedLineups: { home: projectLineup(match.home.players, match.sport), away: projectLineup(match.away.players, match.sport) },
    notice: "Probability estimate, not a guaranteed outcome. Lineups are projected, not confirmed.",
  });
}
