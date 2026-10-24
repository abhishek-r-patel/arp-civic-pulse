import { z } from "zod";
import { exportResults } from "@/server/exports/results-export";
import { parseParams } from "@/server/http/request";
import { route } from "@/server/http/route";
import { memberDeps } from "@/server/votes/submission";
import { uuid } from "@/shared/validation/primitives";

export const dynamic = "force-dynamic";

// The format is validated AFTER authorization so an unavailable format never reveals a vote.
const paramsSchema = z.object({ id: uuid, format: z.string().max(16) });

export const { GET, POST, PUT, PATCH, DELETE } = route({
  GET: async ({ requestId, params }) => {
    const { id, format } = parseParams(params, paramsSchema);
    const deps = await memberDeps();
    return exportResults(deps, id, format, requestId);
  },
});
