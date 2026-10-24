"use client";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export default function ErrorPage({
  reset,
}: Readonly<{ error: Error; reset: () => void }>) {
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
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
