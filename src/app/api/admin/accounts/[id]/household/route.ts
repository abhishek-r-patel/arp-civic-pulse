// Assigns or moves an account's household (administrator only).
import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { parseJsonBody, parseParams } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { setAccountHousehold } from "@/server/register/households";
import { enforceMutationLimit, registerDeps } from "@/server/register/shared";
import {
  accountHouseholdSchema,
  idParamsSchema,
} from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  PUT: async ({ request, requestId, params }) => {
    await assertAuthMutationAllowed(request);
    const { id } = parseParams(params, idParamsSchema);
    const deps = await registerDeps();
    await enforceMutationLimit(deps);
    const { identifier } = await parseJsonBody(request, accountHouseholdSchema);
    return ok(await setAccountHousehold(deps, id, identifier), requestId);
  },
});
