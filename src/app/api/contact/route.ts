// Public support mutation with CSRF, bounded validation and shared atomic send budgets.
import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { enforceRateLimit } from "@/server/auth/rate-limit";
import { contactEnabled, sendContact } from "@/server/contact";
import { createAdminClient } from "@/server/db/clients";
import { ApiError } from "@/server/http/errors";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { contactSchema } from "@/shared/contracts/contact";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  POST: async ({ request, requestId }) => {
    await assertAuthMutationAllowed(request);
    const message = await parseJsonBody(request, contactSchema);
    if (!contactEnabled()) throw new ApiError("DEPENDENCY_UNAVAILABLE");
    const admin = createAdminClient();
    await enforceRateLimit(
      admin,
      { scope: "contact.email", limit: 3, windowSeconds: 3600 },
      "email",
      message.email,
      "DEPENDENCY_UNAVAILABLE",
    );
    await enforceRateLimit(
      admin,
      { scope: "contact.global", limit: 30, windowSeconds: 3600 },
      "email",
      "contact-global",
      "DEPENDENCY_UNAVAILABLE",
    );
    await sendContact(message, requestId);
    return ok(
      {
        message:
          "Your message was accepted by our email service. Delivery to the administrator's inbox is not yet confirmed.",
      },
      requestId,
      202,
    );
  },
});
