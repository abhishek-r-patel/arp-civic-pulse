import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { BODY_LIMITS, parseJsonBody, parseQuery } from "@/server/http/request";
import { ok, paginated } from "@/server/http/response";
import { route } from "@/server/http/route";
import { enforceMutationLimit, registerDeps } from "@/server/register/shared";
import { createDraft, listVotes } from "@/server/votes/drafts";
import {
  createDraftSchema,
  voteListQuerySchema,
} from "@/shared/contracts/admin-votes";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  GET: async ({ request, requestId }) => {
    const deps = await registerDeps();
    const query = parseQuery(request, voteListQuerySchema);
    const { data, page } = await listVotes(deps, query);
    return paginated(data, page, requestId);
  },

  POST: async ({ request, requestId }) => {
    await assertAuthMutationAllowed(request);
    const deps = await registerDeps();
    await enforceMutationLimit(deps);
    const { votingType } = await parseJsonBody(
      request,
      createDraftSchema,
      BODY_LIMITS.small,
    );
    return ok(await createDraft(deps, votingType), requestId, 201);
  },
});
