import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { parseJsonBody, parseParams } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { updateAccount } from "@/server/register/accounts";
import { enforceMutationLimit, registerDeps } from "@/server/register/shared";
import {
  idParamsSchema,
  patchAccountSchema,
} from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  PATCH: async ({ request, requestId, params }) => {
    await assertAuthMutationAllowed(request);
    const { id } = parseParams(params, idParamsSchema);
    const deps = await registerDeps();
    await enforceMutationLimit(deps);
    const changes = await parseJsonBody(request, patchAccountSchema);
    return ok(await updateAccount(deps, id, changes), requestId);
  },
});
