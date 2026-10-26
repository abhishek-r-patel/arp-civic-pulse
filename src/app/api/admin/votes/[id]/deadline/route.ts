import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { BODY_LIMITS, parseJsonBody, parseParams } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { enforceMutationLimit, registerDeps } from "@/server/register/shared";
import { changeVoteDeadline } from "@/server/votes/lifecycle";
import { deadlineChangeSchema } from "@/shared/contracts/admin-votes";
import { idParamsSchema } from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

// Moves an ACTIVE vote's deadline. An overdue vote completes at its deadline and this is refused (409).
export const { GET, POST, PUT, PATCH, DELETE } = route({
  POST: async ({ request, requestId, params }) => {
    await assertAuthMutationAllowed(request);
    const { id } = parseParams(params, idParamsSchema);
    const deps = await registerDeps();
    await enforceMutationLimit(deps);
    const { closesAt, reason } = await parseJsonBody(
      request,
      deadlineChangeSchema,
      BODY_LIMITS.small,
    );
    return ok(await changeVoteDeadline(deps, id, closesAt, reason), requestId);
  },
});
