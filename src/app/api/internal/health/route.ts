import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Readiness only: no account data, configuration, quotas or provider details.
// Dependency checks are added with the Supabase integration.
export function GET() {
  const requestId = crypto.randomUUID();

  return NextResponse.json(
    { data: { status: "ok" }, requestId },
    {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Request-ID": requestId,
      },
    },
  );
}
