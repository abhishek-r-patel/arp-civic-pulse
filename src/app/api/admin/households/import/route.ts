/* Administrator-only per-row import endpoint with CSRF and a bounded bulk-operation budget. */
import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { AUTH_RATE_LIMITS, enforceRateLimit } from "@/server/auth/rate-limit";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { importRegisterRow } from "@/server/register/import";
import { registerDeps } from "@/server/register/shared";
import { importRequestSchema } from "@/shared/contracts/register-import";

export const dynamic = "force-dynamic";
export const { GET, POST, PUT, PATCH, DELETE } = route({
  POST: async ({ request, requestId }) => {
    await assertAuthMutationAllowed(request);
    const deps = await registerDeps();
    await enforceRateLimit(
      deps.admin,
      AUTH_RATE_LIMITS.registerImportByProfile,
      "profile",
      deps.actor.id,
      "DEPENDENCY_UNAVAILABLE",
    );
    const input = await parseJsonBody(request, importRequestSchema);
    return ok(
      await importRegisterRow(deps, input.row, input.action === "import"),
      requestId,
    );
  },
});
