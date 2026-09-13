import { env } from "cloudflare:workers";

export async function GET() {
  let database = "unavailable";
  try {
    if (!env.DB) throw new Error("Database not configured");
    await env.DB.prepare("SELECT id FROM fixtures LIMIT 1").first();
    database = "ready";
  } catch {
    database = "unavailable";
  }
  return Response.json({ status: database === "ready" ? "ok" : "degraded", model: "pitchpredict-v3", database, sports: ["soccer", "basketball"] }, { status: database === "ready" ? 200 : 503 });
}
