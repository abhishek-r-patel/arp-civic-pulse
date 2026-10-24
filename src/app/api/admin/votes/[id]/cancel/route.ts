import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { BODY_LIMITS, parseJsonBody, parseParams } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { enforceMutationLimit, registerDeps } from "@/server/register/shared";
import { cancelVote } from "@/server/votes/lifecycle";
import { lifecycleActionSchema } from "@/shared/contracts/admin-votes";
import { idParamsSchema } from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

// An overdue vote completes at its deadline instead and this action is refused (409).
export const { GET, POST, PUT, PATCH, DELETE } = route({
  POST: async ({ request, requestId, params }) => {
    await assertAuthMutationAllowed(request);
    const { id } = parseParams(params, idParamsSchema);
    const deps = await registerDeps();
    await enforceMutationLimit(deps);
    const { reason } = await parseJsonBody(
      request,
      lifecycleActionSchema,
      BODY_LIMITS.small,
    );
    return ok(await cancelVote(deps, id, reason), requestId);
  },
});
