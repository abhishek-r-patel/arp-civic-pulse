import {
  assertAuthMutationAllowed,
  authDependencies,
} from "@/server/auth/dependencies";
import { verifyCode } from "@/server/auth/otp";
import { rotateCsrfContext } from "@/server/http/csrf-cookie";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { verifyCodeSchema } from "@/shared/contracts/auth";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  POST: async ({ request, requestId }) => {
    await assertAuthMutationAllowed(request);
    const { email, code } = await parseJsonBody(request, verifyCodeSchema);
    const account = await verifyCode(
      await authDependencies(request),
      email,
      code,
    );

    // The pre-authentication CSRF context is replaced once a session exists.
    await rotateCsrfContext();
    return ok({ account }, requestId);
  },
});
