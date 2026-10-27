// Authorized administrative audit-history read endpoint.
import { parseQuery } from "@/server/http/request";
import { paginated } from "@/server/http/response";
import { route } from "@/server/http/route";
import { committeeReadDeps } from "@/server/register/shared";
import { listAuditEvents } from "@/server/votes/monitoring";
import { auditQuerySchema } from "@/shared/contracts/admin-votes";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  GET: async ({ request, requestId }) => {
    const deps = await committeeReadDeps();
    const query = parseQuery(request, auditQuerySchema);
    const { data, page } = await listAuditEvents(deps, query);
    return paginated(data, page, requestId);
  },
});
