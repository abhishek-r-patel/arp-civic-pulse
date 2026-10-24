import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

// Readiness only: no account data, configuration, quotas or provider details.
// Dependency checks are added with the Supabase integration.
export const { GET, POST, PUT, PATCH, DELETE } = route({
  GET: ({ requestId }) => ok({ status: "ok" }, requestId),
});
