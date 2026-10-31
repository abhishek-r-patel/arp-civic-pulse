import {
  assertAuthMutationAllowed,
  authDependencies,
} from "@/server/auth/dependencies";
import { requestCode } from "@/server/auth/otp";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import {
  CODE_REQUEST_MESSAGE,
  requestCodeSchema,
} from "@/shared/contracts/auth";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  POST: async ({ request, requestId }) => {
    await assertAuthMutationAllowed(request);
    const { email } = await parseJsonBody(request, requestCodeSchema);
    const { resendAfterSeconds } = await requestCode(
      await authDependencies(request),
      email,
    );

    // Generic acknowledgement: processed, not proof of delivery or registration.
    return ok(
      { message: CODE_REQUEST_MESSAGE, resendAfterSeconds },
      requestId,
      202,
    );
  },
});
