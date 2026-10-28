import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { enforceMutationLimit, registerDeps } from "@/server/register/shared";
import { setAppSupportAccess } from "@/server/settings/app-support";
import { appSupportAccessSchema } from "@/shared/contracts/app-support";

// Turns read-only App Support Access on or off for the configured support email (administrators only).
export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  PUT: async ({ request, requestId }) => {
    await assertAuthMutationAllowed(request);
    const deps = await registerDeps();
    await enforceMutationLimit(deps);
    const input = await parseJsonBody(request, appSupportAccessSchema);
    return ok(await setAppSupportAccess(deps, input), requestId);
  },
});
