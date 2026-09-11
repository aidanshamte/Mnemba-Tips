import { normalizeOpenFootballRound } from "@/lib/prediction-engine.mjs";

const supported: Record<string, { url: string; label: string }> = {
  england: { url: "https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/en.1.json", label: "England" },
  spain: { url: "https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/es.1.json", label: "Spain" },
  germany: { url: "https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/de.1.json", label: "Germany" },
};

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("league") || "england";
  const source = supported[key];
  if (!source) return Response.json({ error: "Supported leagues: england, spain, germany" }, { status: 400 });
  try {
    const response = await fetch(source.url, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!response.ok) throw new Error(`OpenFootball returned ${response.status}`);
    const payload = await response.json();
    return Response.json({ source: "OpenFootball", license: "Public domain", league: source.label, matches: normalizeOpenFootballRound(payload, source.label) });
  } catch (error) {
    return Response.json({ error: "Open dataset is temporarily unavailable", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 503 });
  }
}
