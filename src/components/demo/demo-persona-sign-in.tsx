// Demo sign-in: one button per fictional persona instead of the email-code form.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";
import { DEMO_PERSONAS, type DemoPersona } from "@/shared/demo";

export function DemoPersonaSignIn({
  csrfToken,
}: Readonly<{ csrfToken: string | undefined }>) {
  const router = useRouter();
  const [pending, setPending] = useState<DemoPersona | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  async function signIn(persona: DemoPersona) {
    if (pending) return;
    setPending(persona);
    setFailure(null);
    const result = await apiRequest<{ account: unknown }>("/api/demo/session", {
      method: "POST",
      body: { persona },
      csrfToken,
    });
    if (!result.ok) {
      setPending(null);
      setFailure(result);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="grid gap-5 form-panel">
      <ErrorSummary failure={failure} />
      {(Object.keys(DEMO_PERSONAS) as DemoPersona[]).map((persona) => (
        <div key={persona} className="grid gap-2">
          <Button
            type="button"
            variant={persona === "resident" ? "primary" : "secondary"}
            loading={pending === persona}
            disabled={pending !== null}
            onClick={() => void signIn(persona)}
          >
            {DEMO_PERSONAS[persona].label}
          </Button>
          <p className="text-caption text-muted">
            {DEMO_PERSONAS[persona].description}
          </p>
        </div>
      ))}
    </div>
  );
}
