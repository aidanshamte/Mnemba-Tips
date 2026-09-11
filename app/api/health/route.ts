import { env } from "cloudflare:workers";

export async function GET() {
  let database = "unavailable";
  try {
    if (!env.DB) throw new Error("Database not configured");
    await env.DB.prepare("SELECT 1 AS ok").first();
    database = "ready";
  } catch {
    database = "not-configured";
  }
  return Response.json({ status: "ok", model: "pitchpredict-v3", database, sports: ["soccer", "basketball"] });
}
