import { createAdminClient } from "@/server/db/clients";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { isMaintenanceMode } from "@/server/maintenance";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 3_000;

async function databaseReachable(): Promise<boolean> {
  try {
    const ping = createAdminClient().rpc("health_ping");
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS),
    );
    const { data, error } = await Promise.race([ping, timeout]);
    return !error && data === true;
  } catch {
    return false;
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
