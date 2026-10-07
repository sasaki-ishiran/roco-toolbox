/** /api/* 全部交给同一个路由（Pages Functions 的 catch-all） */
import { route } from '../_lib/router';
import type { Env } from '../_lib/util';

export const onRequest = (context: EventContext<Env, string, unknown>): Promise<Response> =>
  route(context.request, context.env);
