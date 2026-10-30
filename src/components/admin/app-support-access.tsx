// Administrator toggle for read-only App Support Access; observers see it disabled.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { Notice } from "@/components/ui/notice";
import type { AppSupportStatus } from "@/shared/contracts/app-support";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";

export function AppSupportAccessControl({
  csrfToken,
  initialStatus,
}: Readonly<{
  csrfToken: string | undefined;
  initialStatus: AppSupportStatus;
}>) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [pending, setPending] = useState(false);

  async function change(enabled: boolean) {
    if (pending) return;
    setFailure(null);
    setPending(true);
    const result = await apiRequest<AppSupportStatus>(
      "/api/admin/settings/app-support",
      { method: "PUT", body: { enabled }, csrfToken },
    );
    setPending(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setStatus(result.data);
    router.refresh();
  }

  return (
    <section
      id="app-support"
      aria-labelledby="app-support-heading"
      className="grid max-w-ballot gap-4 form-panel"
    >
      <h2 id="app-support-heading" className="text-section font-semibold">
        App Support Access
      </h2>
      <p className="text-body">
        Let the Civic Pulse developer sign in to help check your setup. Support
        can view the register, settings, votes, participation, results and audit
        history, but cannot change anything or vote. Support has no household.
        PRIVATE vote choices stay secret. Turning access on or off is recorded
        in the audit history. Turn it off when you no longer need help.
      </p>
      <ErrorSummary failure={failure} />
      {status.configured ? (
        <>
          <dl className="grid gap-1 text-body">
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-semibold">Support email:</dt>
              <dd className="break-all">{status.email}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-semibold">Status:</dt>
              <dd>{status.enabled ? "On" : "Off"}</dd>
            </div>
          </dl>
          <Button
            type="button"
            variant={status.enabled ? "destructive" : "primary"}
            loading={pending}
            className="sm:w-fit"
            onClick={() => void change(!status.enabled)}
          >
            <LifeBuoy aria-hidden="true" className="size-5" />
            {status.enabled
              ? "Turn Off App Support Access"
              : "Turn On App Support Access"}
          </Button>
        </>
      ) : (
        <Notice tone="info" heading="Not Configured">
          This deployment has no app support email, so App Support Access is
          unavailable.
          {status.enabled
            ? " A previously enabled support account is still on; turn it off below."
            : ""}
        </Notice>
      )}
      {!status.configured && status.enabled ? (
        <Button
          type="button"
          variant="destructive"
          loading={pending}
          className="sm:w-fit"
          onClick={() => void change(false)}
        >
          <LifeBuoy aria-hidden="true" className="size-5" />
          Turn Off App Support Access
        </Button>
      ) : null}
    </section>
  );
}
