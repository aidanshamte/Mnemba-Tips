import {internalAccess,publicViews} from '@/lib/football/access.mjs';
import { env } from 'cloudflare:workers';
import { Store } from '@/lib/football/store.mjs';
import { IntelligenceService as FootballService } from '@/lib/football/intelligence.mjs';
import {registerSources} from '@/lib/football/source-registry.mjs';

let initialized: Promise<void> | undefined;
function service() {
  const bindings = env as unknown as Record<string, any>;
  if (!bindings.DB) throw new Error('Local D1 database unavailable');
  const store = new Store(bindings.DB);
  initialized ??= store.init().then(()=>registerSources(store,bindings)).catch((error: unknown) => { initialized = undefined; throw error; });
  return { ready: initialized, instance: new FootballService(store, { API_FOOTBALL_KEY: bindings.API_FOOTBALL_KEY, FOOTBALL_DATA_KEY: bindings.FOOTBALL_DATA_KEY, NEWS_API_KEY: bindings.NEWS_API_KEY, NODE_ENV: process.env.NODE_ENV }) };
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (!publicViews.has(params.get('view') ?? 'fixtures') && !internalAccess(request,(env as unknown as Record<string,unknown>).MNEMBA_INTERNAL_TOKEN)) return Response.json({ error: 'Diagnostics are local-only' }, { status: 403 });
    const { ready, instance } = service(); await ready;
    return Response.json(await instance.read(params), { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Football data is unavailable. Check the local database and diagnostics.' }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!internalAccess(request,(env as unknown as Record<string,unknown>).MNEMBA_INTERNAL_TOKEN) || request.headers.get('content-type') !== 'application/json') return Response.json({ error: 'Synchronization requires a same-origin local request' }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const { ready, instance } = service(); await ready;
    if (typeof body.job === 'string') {
      if (!/^(catalog:(api-football|football-data)|countries:(api-football|football-data)|today|upcoming|live|news|historical|(history-import|calendar|teams|standings|players|scorers|statistics|selected|detail|lineups|injuries|events|h2h|provider-prediction|player-statistics):[a-z0-9:._-]+)$/.test(body.job)) return Response.json({ error: 'Invalid synchronization job' }, { status: 400 });
      return Response.json(await instance.job(body.job, true));
    }
    const context = { visible: body.visible === true, selected: typeof body.selected === 'string' ? body.selected : undefined, competition: typeof body.competition === 'string' ? body.competition : undefined, season: typeof body.season === 'string' ? body.season : undefined };
    return Response.json(await instance.tick(context));
  } catch { return Response.json({ error: 'Synchronization unavailable; cached records are preserved' }, { status: 503 }); }
}
