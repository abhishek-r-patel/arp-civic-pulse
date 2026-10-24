import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { parseJsonBody, parseQuery } from "@/server/http/request";
import { ok, paginated } from "@/server/http/response";
import { route } from "@/server/http/route";
import { createHousehold, listHouseholds } from "@/server/register/households";
import { enforceMutationLimit, registerDeps } from "@/server/register/shared";
import {
  createHouseholdSchema,
  householdListQuerySchema,
} from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  GET: async ({ request, requestId }) => {
    const deps = await registerDeps();
    const query = parseQuery(request, householdListQuerySchema);
    const { data, page } = await listHouseholds(deps, query);
    return paginated(data, page, requestId);
  },

  POST: async ({ request, requestId }) => {
    await assertAuthMutationAllowed(request);
    const deps = await registerDeps();
    await enforceMutationLimit(deps);
    const input = await parseJsonBody(request, createHouseholdSchema);
    return ok(await createHousehold(deps, input), requestId, 201);
  },
});
