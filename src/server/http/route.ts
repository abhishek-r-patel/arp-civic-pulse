// Consistent safe HTTP request/response behavior for application routes.
import "server-only";
import { ApiError } from "@/server/http/errors";
import { errorResponse, newRequestId } from "@/server/http/response";
import { isMaintenanceMode } from "@/server/maintenance";
import { log } from "@/server/observability/logger";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof METHODS)[number];

export type RouteParams = Record<string, string | string[] | undefined>;

export interface RouteContext {
  request: Request;
  requestId: string;
  params: RouteParams;
}

export type RouteHandler = (
  context: RouteContext,
) => Promise<Response> | Response;

interface NextRouteContext {
  params?: Promise<RouteParams>;
}

/*
 * Wraps a route's handlers so every response carries a random support ID, known
 * failures map to the shared error envelope, unexpected failures become a safe
 * 500 (never a success-shaped fallback), and unsupported methods return 405
 * with `Allow`. Usage: `export const { GET, POST, PUT, PATCH, DELETE } = route({ ... })`.
 */
export function route(
  handlers: Partial<Record<HttpMethod, RouteHandler>>,
): Record<
  HttpMethod,
  (request: Request, context?: NextRouteContext) => Promise<Response>
> {
  const allow = METHODS.filter((method) => handlers[method]);

  const entries = METHODS.map((method) => {
    const handler = handlers[method];

    return [
      method,
      async (
        request: Request,
        nextContext?: NextRouteContext,
      ): Promise<Response> => {
        const requestId = newRequestId();
        const started = performance.now();
        const routeName = new URL(request.url).pathname;

        let response: Response;
        try {
          if (!handler) {
            throw new ApiError("METHOD_NOT_ALLOWED", { allow });
          }
          // Maintenance stops every data path; the health route stays honest about it.
          if (
            isMaintenanceMode() &&
            !routeName.endsWith("/api/internal/health")
          ) {
            throw new ApiError("DEPENDENCY_UNAVAILABLE", {
              message: "The service is being maintained. Try again later.",
              retryAfterSeconds: 300,
            });
          }
          const params = (await nextContext?.params) ?? {};
          response = await handler({ request, requestId, params });
        } catch (error) {
          if (error instanceof ApiError) {
            response = errorResponse(error, requestId);
          } else {
            log("error", "request.unhandled", {
              requestId,
              route: routeName,
              method,
              errorName: error instanceof Error ? error.name : "UnknownError",
            });
            response = errorResponse(new ApiError("INTERNAL_ERROR"), requestId);
          }
        }

        log("debug", "request.completed", {
          requestId,
          route: routeName,
          method,
          status: response.status,
          durationMs: Math.round(performance.now() - started),
        });
        return response;
      },
    ] as const;
  });

  return Object.fromEntries(entries) as Record<
    HttpMethod,
    (request: Request, context?: NextRouteContext) => Promise<Response>
  >;
}
