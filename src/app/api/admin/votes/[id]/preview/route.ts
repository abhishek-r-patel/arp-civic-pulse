// Non-mutating draft preview endpoint with committee read authorization.
import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { BODY_LIMITS, parseJsonBody, parseParams } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import {
  enforceMutationLimit,
  committeeReadDeps,
} from "@/server/register/shared";
import { previewDraft } from "@/server/votes/drafts";
import { revisionOnlySchema } from "@/shared/contracts/admin-votes";
import { idParamsSchema } from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

// Preview validates and renders; it never stores a report or changes the revision.
export const { GET, POST, PUT, PATCH, DELETE } = route({
  POST: async ({ request, requestId, params }) => {
    await assertAuthMutationAllowed(request);
    const { id } = parseParams(params, idParamsSchema);
    const deps = await committeeReadDeps();
    await enforceMutationLimit(deps);
    const { expectedRevision } = await parseJsonBody(
      request,
      revisionOnlySchema,
      BODY_LIMITS.small,
    );
    return ok(await previewDraft(deps, id, expectedRevision), requestId);
  },
});
