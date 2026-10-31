"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export default function ErrorPage({
  error,
  reset,
}: Readonly<{ error: Error; reset: () => void }>) {
  // Boundary-caught render errors never reach the global handler; report them here.
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="grid max-w-ballot gap-4">
      <h1 className="text-page-title font-semibold md:text-page-title-lg">
        Something went wrong
      </h1>
      <Notice tone="error" heading="We could not load this page">
        Nothing you entered has been changed. Try again, and contact the RWA
        administrators if the problem continues.
      </Notice>
      <div>
        <Button onClick={reset}>Try Again</Button>
      </div>
    </div>
  );
}
