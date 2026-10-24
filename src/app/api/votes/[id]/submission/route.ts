import { assertAuthMutationAllowed } from "@/server/auth/dependencies";
import { BODY_LIMITS, parseJsonBody, parseParams } from "@/server/http/request";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { memberDeps, submitBallot } from "@/server/votes/submission";
import { submissionSchema } from "@/shared/contracts/ballots";
import { idParamsSchema } from "@/shared/contracts/register";

export const dynamic = "force-dynamic";

/*
 * One final ballot. The body carries no identity, household, timestamp, count
 * or idempotency identifier: the guarded database routine derives everything
 * from the verified session and the frozen electorate. The acknowledgement is
 * participation only, sent after the commit.
 */
export const { GET, POST, PUT, PATCH, DELETE } = route({
  POST: async ({ request, requestId, params }) => {
    await assertAuthMutationAllowed(request);
    const { id } = parseParams(params, idParamsSchema);
    const deps = await memberDeps();
    const submission = await parseJsonBody(
      request,
      submissionSchema,
      BODY_LIMITS.small,
    );
    return ok(await submitBallot(deps, id, submission), requestId);
  },
});
