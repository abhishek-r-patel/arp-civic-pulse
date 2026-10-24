import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { BODY_LIMITS, parseJsonBody, parseParams } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { enforceMutationLimit, registerDeps } from "@/server/register/shared";
import { activateVote } from "@/server/votes/lifecycle";
import { activateSchema } from "@/shared/contracts/admin-votes";
import { idParamsSchema } from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

// Freezes and activates exactly the revision the administrator previewed.
export const { GET, POST, PUT, PATCH, DELETE } = route({
  POST: async ({ request, requestId, params }) => {
    await assertAuthMutationAllowed(request);
    const { id } = parseParams(params, idParamsSchema);
    const deps = await registerDeps();
    await enforceMutationLimit(deps);
    const { expectedRevision } = await parseJsonBody(
      request,
      activateSchema,
      BODY_LIMITS.small,
    );
    return ok(await activateVote(deps, id, expectedRevision), requestId);
  },
});
