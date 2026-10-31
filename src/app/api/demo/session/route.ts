// Demo-host-only persona sign-in: CSRF-protected, globally rate-limited, no email sent.
import {
  assertAuthMutationAllowed,
  authDependencies,
} from "@/server/auth/dependencies";
import { signInAsDemoPersona } from "@/server/demo/session";
import { rotateCsrfContext } from "@/server/http/csrf-cookie";
import { ApiError } from "@/server/http/errors";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { demoSessionSchema } from "@/shared/demo";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  POST: async ({ request, requestId, tenant }) => {
    // Checked before CSRF so non-demo hosts reveal nothing about this route.
    if (tenant?.kind !== "demo") {
      throw new ApiError("NOT_FOUND", {
        cause: { source: "tenant_config", code: "NOT_DEMO_HOST" },
      });
    }
    await assertAuthMutationAllowed(request);
    const { persona } = await parseJsonBody(request, demoSessionSchema);
    const account = await signInAsDemoPersona(
      await authDependencies(),
      persona,
    );
    await rotateCsrfContext();
    return ok({ account }, requestId);
  },
});
