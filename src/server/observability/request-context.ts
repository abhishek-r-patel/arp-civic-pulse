/*
 * Per-request log context. The request wrapper (src/server/http/route.ts) runs
 * each handler inside this store, so every log line and Sentry report written
 * anywhere during that request, including nested service code, automatically
 * carries the same error ID, area, route, method, host and tenant. Outside a
 * request (for example a Server Component render) there is no context and
 * nothing is added.
 */
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestLogContext {
  readonly requestId: string;
  readonly area: string;
  readonly route: string;
  readonly method: string;
  readonly host: string;
  readonly tenant: string;
}

const storage = new AsyncLocalStorage<RequestLogContext>();

export function runWithRequestContext<T>(
  context: RequestLogContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}

export function currentRequestContext(): RequestLogContext | undefined {
  return storage.getStore();
}
