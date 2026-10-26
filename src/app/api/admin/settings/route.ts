import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { enforceMutationLimit, registerDeps } from "@/server/register/shared";
import { updateRwaProfile } from "@/server/settings/rwa-profile";
import { updateRwaProfileSchema } from "@/shared/contracts/rwa-profile";

// Updates the RWA profile through its administrator-only guarded RPC.
export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  PATCH: async ({ request, requestId }) => {
    await assertAuthMutationAllowed(request);
    const deps = await registerDeps();
    await enforceMutationLimit(deps);
    const input = await parseJsonBody(request, updateRwaProfileSchema);
    return ok(await updateRwaProfile(deps, input), requestId);
  },
});
