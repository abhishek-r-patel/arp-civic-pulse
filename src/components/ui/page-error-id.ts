"use client";

/*
 * Error ID for page-level crashes caught by the error boundaries
 * (src/app/error.tsx, src/app/global-error.tsx). The ID is created in the
 * browser, shown to the person and sent to Sentry as the `error_id` tag.
 * The Next.js `digest` tag links to the server-side log line for errors
 * thrown while rendering on the server.
 */
import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";
import { newErrorId } from "@/shared/observability/error-id";

export function usePageErrorId(
  error: unknown,
  boundary: "page" | "root",
): string {
  const [errorId] = useState(() => newErrorId("PAGE"));

  useEffect(() => {
    const digest =
      error instanceof Error && "digest" in error
        ? String((error as { digest?: unknown }).digest ?? "")
        : "";
    Sentry.captureException(error, {
      tags: {
        error_id: errorId,
        error_code: "PAGE_RENDER_FAILED",
        error_category: "internal",
        error_type: "system",
        boundary,
        ...(digest && { digest }),
      },
    });
  }, [error, errorId, boundary]);

  return errorId;
}
