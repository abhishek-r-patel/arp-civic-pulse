"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/shared/http/api-client";
import { describeFailure } from "@/shared/http/messages";

// Sign-out failures are surfaced, never reported as success.
export function SignOutButton({
  csrfToken,
}: Readonly<{ csrfToken: string | undefined }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setPending(true);
    setError(null);
    const result = await apiRequest<undefined>("/api/auth/sign-out", {
      method: "POST",
      body: {},
      csrfToken,
    });

    if (!result.ok) {
      setPending(false);
      setError(describeFailure(result));
      return;
    }
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <div className="grid gap-1">
      <Button
        variant="secondary"
        onClick={signOut}
        loading={pending}
        className="sm:w-auto"
      >
        <LogOut aria-hidden="true" className="size-5" />
        Sign out
      </Button>
      {error ? (
        <p role="alert" className="text-caption font-semibold text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
