import { parseParams } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { getMemberVote } from "@/server/votes/member";
import { memberDeps } from "@/server/votes/submission";
import { idParamsSchema } from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  GET: async ({ requestId, params }) => {
    const { id } = parseParams(params, idParamsSchema);
    const deps = await memberDeps();
    return ok(await getMemberVote(deps, id), requestId);
  },
});
