import { parseQuery } from "@/server/http/request";
import { paginated } from "@/server/http/response";
import { route } from "@/server/http/route";
import { listMemberVotes } from "@/server/votes/member";
import { memberDeps } from "@/server/votes/submission";
import { memberVoteListQuerySchema } from "@/shared/contracts/member-votes";

export const dynamic = "force-dynamic";

// The caller's own frozen entitlements: never drafts, never other households.
export const { GET, POST, PUT, PATCH, DELETE } = route({
  GET: async ({ request, requestId }) => {
    const deps = await memberDeps();
    const query = parseQuery(request, memberVoteListQuerySchema);
    const { data, page } = await listMemberVotes(deps, query);
    return paginated(data, page, requestId);
  },
});
