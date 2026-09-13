import handler from 'vinext/server/fetch-handler';
import { runScheduled } from './lib/football/scheduled.mjs';

const worker = {
  fetch: handler.fetch,
  scheduled(controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(controller, env));
  },
};

export default worker;
