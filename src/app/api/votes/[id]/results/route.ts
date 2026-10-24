import { parseParams, parseQuery } from "@/server/http/request";
import { okWithPage } from "@/server/http/response";
import { route } from "@/server/http/route";
import { getResults } from "@/server/votes/member";
import { memberDeps } from "@/server/votes/submission";
import { listQuerySchema } from "@/shared/contracts/pagination";
import { idParamsSchema } from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

const resultsQuerySchema = listQuerySchema({});

// Completed votes only. Totals always cover every response; limit and cursor page the named OPEN list.
export const { GET, POST, PUT, PATCH, DELETE } = route({
  GET: async ({ request, requestId, params }) => {
    const { id } = parseParams(params, idParamsSchema);
    const deps = await memberDeps();
    const query = parseQuery(request, resultsQuerySchema);
    const { data, page } = await getResults(deps, id, query);
    return okWithPage(data, page, requestId);
  },
});
