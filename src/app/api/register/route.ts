// Public resident self-registration with CSRF, bounded validation, a honeypot and shared budgets.
import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { createAdminClient } from "@/server/db/clients";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { selfRegister } from "@/server/register/self-registration";
import { selfRegistrationSchema } from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

const ACCEPTED =
  "Your registration was received. Your account stays suspended until your RWA administrator reviews and enables it.";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  POST: async ({ request, requestId }) => {
    await assertAuthMutationAllowed(request);
    const input = await parseJsonBody(request, selfRegistrationSchema);
    // Automated form fillers get the normal answer so they learn nothing.
    if (input.website) {
      return ok({ message: ACCEPTED }, requestId, 202);
    }
    await selfRegister(createAdminClient(), input);
    return ok({ message: ACCEPTED }, requestId, 202);
  },
});
