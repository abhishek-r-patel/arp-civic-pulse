// Consistent safe HTTP request/response behavior for application routes.
import "server-only";
import {
  tenantContextForProxy,
  type TenantContext,
} from "@/server/config/tenant-context";
import { ApiError } from "@/server/http/errors";
import { demoRequestAllowed, mainHostApiAllowed } from "@/shared/host-routes";
import { errorResponse, newRequestId } from "@/server/http/response";
import { isMaintenanceMode } from "@/server/maintenance";
import { log } from "@/server/observability/logger";
import { reportError } from "@/server/observability/error-reporting";
import {
  runWithRequestContext,
  type RequestLogContext,
} from "@/server/observability/request-context";
import { areaForPath } from "@/shared/observability/error-id";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof METHODS)[number];

export type RouteParams = Record<string, string | string[] | undefined>;

export interface RouteContext {
  request: Request;
  requestId: string;
  params: RouteParams;
  /** Host-resolved tenant when the host is known; handlers still resolve their own backend. */
  tenant?: TenantContext | undefined;
}

export type RouteHandler = (
  context: RouteContext,
) => Promise<Response> | Response;

interface NextRouteContext {
  params?: Promise<RouteParams>;
}

const SAFE_HOST = /^[a-z0-9.-]{1,253}(?::\d{1,5})?$/u;

// The Host header is attacker-controlled, so only a plain host[:port] is logged.
function logHost(request: Request): string {
  const value = (
    request.headers.get("host") ?? new URL(request.url).host
  ).toLowerCase();
  return SAFE_HOST.test(value) ? value : "invalid";
}

// Which RWA the request was for. Never throws: logging must not fail a request.
function resolveTenant(host: string): TenantContext | undefined {
  try {
    return tenantContextForProxy(host);
  } catch {
    return undefined;
  }
}

/*
 * Host-kind limits, applied before any handler runs (src/shared/host-routes.ts):
 * the main website has no RWA backend, and the demo refuses email-dependent writes.
 */
function enforceHostKind(
  tenant: TenantContext | undefined,
  method: HttpMethod,
  pathname: string,
): void {
  if (tenant?.kind === "main" && !mainHostApiAllowed(pathname)) {
    throw new ApiError("NOT_FOUND", {
      cause: { source: "tenant_config", code: "MAIN_HOST_NO_API" },
    });
  }
  if (tenant?.kind === "demo" && !demoRequestAllowed(method, pathname)) {
    throw new ApiError("DEMO_EMAIL_DISABLED");
  }
}

/*
 * Every failed request is logged once as `request.failed` with its error code,
 * category, type, safe cause and an operator hint, at the catalogue's level
 * (src/server/http/errors.ts). System faults also go to Sentry, grouped by
 * code and route, with the error ID as the `error_id` tag.
 */
function recordFailure(error: ApiError, durationMs: number): void {
  const reason = error.context?.reason;
  log(error.logLevel, "request.failed", {
    status: error.status,
    errorCode: error.code,
    errorCategory: error.category,
    errorType: error.errorType,
    reason: typeof reason === "string" ? reason : undefined,
    causeSource: error.safeCause?.source,
    causeCode: error.safeCause?.code,
    causeStatus: error.safeCause?.status,
    hint: error.hint,
    durationMs,
  });
  if (error.reportable) {
    reportError(
      error,
      {
        error_code: error.code,
        error_category: error.category,
        error_type: error.errorType,
        cause_source: error.safeCause?.source,
        cause_code: error.safeCause?.code,
        cause_status: error.safeCause?.status,
      },
      { fingerprint: ["api-error", error.code, "{{ transaction }}"] },
    );
  }
}

/*
 * Wraps a route's handlers so every response carries a readable random error
 * ID (`AREA-XXXXX-XXXXX`), known failures map to the shared error envelope,
 * unexpected failures become a safe 500 (never a success-shaped fallback),
 * and unsupported methods return 405 with `Allow`. Handlers run inside a
 * request log context, so nested logs and Sentry reports carry the same ID.
 * Usage: `export const { GET, POST, PUT, PATCH, DELETE } = route({ ... })`.
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
        const started = performance.now();
        const routeName = new URL(request.url).pathname;
        const area = areaForPath(routeName);
        const requestId = newRequestId(area);
        const host = logHost(request);
        const tenant = resolveTenant(host);
        const context: RequestLogContext = {
          requestId,
          area,
          route: routeName,
          method,
          host,
          tenant: tenant ? (tenant.tenantId ?? tenant.kind) : "unresolved",
        };

        return runWithRequestContext(context, async () => {
          let response: Response;
          try {
            if (!handler) {
              throw new ApiError("METHOD_NOT_ALLOWED", { allow });
            }
            enforceHostKind(tenant, method, routeName);
            // Maintenance stops every data path; the health route stays honest about it.
            if (
              isMaintenanceMode() &&
              !routeName.endsWith("/api/internal/health")
            ) {
              throw new ApiError("DEPENDENCY_UNAVAILABLE", {
                message: "The service is being maintained. Try again later.",
                retryAfterSeconds: 300,
                cause: { source: "maintenance", code: "MAINTENANCE_MODE" },
                report: false,
              });
            }
            const params = (await nextContext?.params) ?? {};
            response = await handler({ request, requestId, params, tenant });
          } catch (error) {
            const durationMs = Math.round(performance.now() - started);
            if (error instanceof ApiError) {
              recordFailure(error, durationMs);
              response = errorResponse(error, requestId);
            } else {
              const internal = new ApiError("INTERNAL_ERROR");
              // The original error's message may hold data; only its class name is logged.
              log("error", "request.unhandled", {
                status: internal.status,
                errorCode: internal.code,
                errorCategory: internal.category,
                errorType: internal.errorType,
                errorName: error instanceof Error ? error.name : "UnknownError",
                hint: internal.hint,
                durationMs,
              });
              reportError(
                error,
                {
                  error_code: internal.code,
                  error_category: internal.category,
                  error_type: internal.errorType,
                },
                { fingerprint: ["unhandled", "{{ default }}"] },
              );
              response = errorResponse(internal, requestId);
            }
          }

          log("debug", "request.completed", {
            status: response.status,
            durationMs: Math.round(performance.now() - started),
          });
          return response;
        });
      },
    ] as const;
  });

  return Object.fromEntries(entries) as Record<
    HttpMethod,
    (request: Request, context?: NextRouteContext) => Promise<Response>
  >;
}
