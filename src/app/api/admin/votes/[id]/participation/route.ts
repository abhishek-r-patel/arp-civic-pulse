// Authorized read endpoint for frozen household participation status.
import { parseParams, parseQuery } from "@/server/http/request";
import { okWithPage } from "@/server/http/response";
import { route } from "@/server/http/route";
import { committeeReadDeps } from "@/server/register/shared";
import { getParticipationReport } from "@/server/votes/monitoring";
import { participationQuerySchema } from "@/shared/contracts/admin-votes";
import { idParamsSchema } from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

// Who has and has not submitted. Never a selection, an email or a submission time.
export const { GET, POST, PUT, PATCH, DELETE } = route({
  GET: async ({ request, requestId, params }) => {
    const { id } = parseParams(params, idParamsSchema);
    const deps = await committeeReadDeps();
    const query = parseQuery(request, participationQuerySchema);
    const { data, page } = await getParticipationReport(deps, id, query);
    return okWithPage(data, page, requestId);
  },
});
