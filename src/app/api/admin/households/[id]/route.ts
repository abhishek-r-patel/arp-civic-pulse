// Household detail reads and administrator-only updates endpoint.
import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { parseJsonBody, parseParams } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { getHousehold, updateHousehold } from "@/server/register/households";
import { enforceMutationLimit, registerDeps } from "@/server/register/shared";
import { committeeReadDeps } from "@/server/register/shared";
import {
  idParamsSchema,
  patchHouseholdSchema,
} from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  GET: async ({ requestId, params }) => {
    const { id } = parseParams(params, idParamsSchema);
    const deps = await committeeReadDeps();
    return ok(await getHousehold(deps, id), requestId);
  },

  PATCH: async ({ request, requestId, params }) => {
    await assertAuthMutationAllowed(request);
    const { id } = parseParams(params, idParamsSchema);
    const deps = await registerDeps();
    await enforceMutationLimit(deps);
    const changes = await parseJsonBody(request, patchHouseholdSchema);
    return ok(await updateHousehold(deps, id, changes), requestId);
  },
});
