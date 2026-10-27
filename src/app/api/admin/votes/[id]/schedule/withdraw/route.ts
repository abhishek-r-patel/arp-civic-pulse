/* Audited return to draft, guarded against withdrawal at or after opening. */
import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { parseJsonBody, parseParams } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { enforceMutationLimit, registerDeps } from "@/server/register/shared";
import { withdrawVoteSchedule } from "@/server/votes/lifecycle";
import { lifecycleActionSchema } from "@/shared/contracts/admin-votes";
import { idParamsSchema } from "@/shared/contracts/register";

export const dynamic = "force-dynamic";
export const { GET, POST, PUT, PATCH, DELETE } = route({
  POST: async ({ request, requestId, params }) => {
    await assertAuthMutationAllowed(request);
    const { id } = parseParams(params, idParamsSchema);
    const deps = await registerDeps();
    await enforceMutationLimit(deps);
    const { reason } = await parseJsonBody(request, lifecycleActionSchema);
    return ok(await withdrawVoteSchedule(deps, id, reason), requestId);
  },
});
