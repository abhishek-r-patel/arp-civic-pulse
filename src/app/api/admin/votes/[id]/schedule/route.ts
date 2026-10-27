/* Freeze a previewed draft now and schedule database-clock opening. */
import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { parseJsonBody, parseParams } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { enforceMutationLimit, registerDeps } from "@/server/register/shared";
import { scheduleVote } from "@/server/votes/lifecycle";
import { scheduleVoteSchema } from "@/shared/contracts/admin-votes";
import { idParamsSchema } from "@/shared/contracts/register";

export const dynamic = "force-dynamic";
export const { GET, POST, PUT, PATCH, DELETE } = route({
  POST: async ({ request, requestId, params }) => {
    await assertAuthMutationAllowed(request);
    const { id } = parseParams(params, idParamsSchema);
    const deps = await registerDeps();
    await enforceMutationLimit(deps);
    const input = await parseJsonBody(request, scheduleVoteSchema);
    return ok(
      await scheduleVote(deps, id, input.expectedRevision, input.opensAt),
      requestId,
    );
  },
});
