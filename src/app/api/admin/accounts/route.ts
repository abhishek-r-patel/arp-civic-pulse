import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { parseJsonBody, parseQuery } from "@/server/http/request";
import { ok, paginated } from "@/server/http/response";
import { route } from "@/server/http/route";
import { createAccount, listAccounts } from "@/server/register/accounts";
import { enforceMutationLimit, registerDeps } from "@/server/register/shared";
import { accountListQuerySchema } from "@/shared/contracts/admin-votes";
import { createAccountSchema } from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  GET: async ({ request, requestId }) => {
    const deps = await registerDeps();
    const query = parseQuery(request, accountListQuerySchema);
    const { data, page } = await listAccounts(deps, query);
    return paginated(data, page, requestId);
  },

  POST: async ({ request, requestId }) => {
    await assertAuthMutationAllowed(request);
    const deps = await registerDeps();
    await enforceMutationLimit(deps);
    const input = await parseJsonBody(request, createAccountSchema);
    return ok(await createAccount(deps, input), requestId, 201);
  },
});
