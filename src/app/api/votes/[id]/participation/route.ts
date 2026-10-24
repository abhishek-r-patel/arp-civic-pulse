import { parseParams } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { getParticipation, memberDeps } from "@/server/votes/submission";
import { idParamsSchema } from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

// The caller's own committed status. `submitted: false` is the current state,
// not proof that an earlier in-flight request cannot still commit.
export const { GET, POST, PUT, PATCH, DELETE } = route({
  GET: async ({ requestId, params }) => {
    const { id } = parseParams(params, idParamsSchema);
    const deps = await memberDeps();
    return ok(await getParticipation(deps, id), requestId);
  },
});
