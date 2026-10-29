// Administrative vote detail, revision-checked draft editing and draft deletion.
import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { BODY_LIMITS, parseJsonBody, parseParams } from "@/server/http/request";
import { noContent, ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { enforceMutationLimit, registerDeps } from "@/server/register/shared";
import { committeeReadDeps } from "@/server/register/shared";
import { deleteDraft, getVote, updateDraft } from "@/server/votes/drafts";
import {
  deleteDraftSchema,
  draftPatchSchema,
} from "@/shared/contracts/admin-votes";
import { idParamsSchema } from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE } = route({
  GET: async ({ requestId, params }) => {
    const { id } = parseParams(params, idParamsSchema);
    const deps = await committeeReadDeps();
    return ok(await getVote(deps, id), requestId);
  },

  PATCH: async ({ request, requestId, params }) => {
    await assertAuthMutationAllowed(request);
    const { id } = parseParams(params, idParamsSchema);
    const deps = await registerDeps();
    await enforceMutationLimit(deps);
    const patch = await parseJsonBody(
      request,
      draftPatchSchema,
      BODY_LIMITS.draft,
    );
    return ok(await updateDraft(deps, id, patch), requestId);
  },

  DELETE: async ({ request, requestId, params }) => {
    await assertAuthMutationAllowed(request);
    const { id } = parseParams(params, idParamsSchema);
    const deps = await registerDeps();
    await enforceMutationLimit(deps);
    const { expectedRevision } = await parseJsonBody(
      request,
      deleteDraftSchema,
      BODY_LIMITS.small,
    );
    await deleteDraft(deps, id, expectedRevision);
    return noContent(requestId);
  },
});
