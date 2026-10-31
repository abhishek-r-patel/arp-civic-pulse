"use client";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { usePageErrorId } from "@/components/ui/page-error-id";

// Boundary-caught render errors never reach the global handler; report them here.
export default function ErrorPage({
  error,
  reset,
}: Readonly<{ error: Error; reset: () => void }>) {
  const errorId = usePageErrorId(error, "page");

  return (
    <div className="grid max-w-ballot gap-4">
      <h1 className="text-page-title font-semibold md:text-page-title-lg">
        Something went wrong
      </h1>
      <Notice tone="error" heading="We could not load this page">
        Nothing you entered has been changed. Try again, and contact the RWA
        administrators if the problem continues.
      </Notice>
      <p className="text-caption text-muted">
        Error ID:{" "}
        <span className="font-mono font-semibold text-primary select-all">
          {errorId}
        </span>
        . Share this ID with your RWA administrator if the problem continues.
      </p>
      <div>
        <Button onClick={reset}>Try Again</Button>
      </div>
    </div>
  );
}
