import { createAdminClient } from "@/server/db/clients";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { isMaintenanceMode } from "@/server/maintenance";
import { log } from "@/server/observability/logger";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 3_000;

async function databaseReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const { data, error, status } = await createAdminClient()
      .rpc("health_ping")
      .abortSignal(controller.signal);
    if (!error && data === true) {
      return true;
    }
    log("warn", "health.database_unavailable", { status });
    return false;
  } catch (error) {
    log("warn", "health.database_unavailable", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Readiness only: one word and a support ID. No account data, configuration,
// quotas, versions or provider details, and a failure never says which part
// failed. Hitting this is not a keep-alive: it exists for monitors, not to hold
// a paused project awake.
export const { GET, POST, PUT, PATCH, DELETE } = route({
  GET: async ({ requestId }) =>
    !isMaintenanceMode() && (await databaseReachable())
      ? ok({ status: "ok" }, requestId)
      : ok({ status: "unavailable" }, requestId, 503),
});
