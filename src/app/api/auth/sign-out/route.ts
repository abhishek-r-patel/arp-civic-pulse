import {
  assertAuthMutationAllowed,
  authDependencies,
} from "@/server/auth/dependencies";
import { signOut } from "@/server/auth/otp";
import { rotateCsrfContext } from "@/server/http/csrf-cookie";
import { parseJsonBody } from "@/server/http/request";
import { noContent } from "@/server/http/response";
import { route } from "@/server/http/route";
import { signOutSchema } from "@/shared/contracts/auth";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  POST: async ({ request, requestId }) => {
    await assertAuthMutationAllowed(request);
    await parseJsonBody(request, signOutSchema);
    await signOut(await authDependencies());

    await rotateCsrfContext();
    return noContent(requestId);
  },
});
