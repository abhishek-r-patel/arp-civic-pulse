"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";
import { fieldErrorFor } from "@/shared/http/messages";

/*
 * Registered-member access: email, then a six-digit code (docs/DESIGN_SYSTEM.md
 * section 11). The acknowledgement after requesting a code is deliberately
 * generic and never confirms that an address is registered or that email was
 * delivered. The code is one text input (not six boxes, not a number input) so
 * paste, autofill and leading zeros work.
 */
const CODE_LENGTH = 6;

type RequestCodeData = { message: string; resendAfterSeconds: number };

// Paste-friendly: keep digits only (drops spaces and hyphens) and cap the length.
export function normalizeCodeInput(value: string): string {
  return value.replace(/\D/gu, "").slice(0, CODE_LENGTH);
}

export function SignInForm({
  csrfToken,
}: Readonly<{ csrfToken: string | undefined }>) {
  const router = useRouter();
  const codeInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (step === "code") {
      codeInput.current?.focus();
    }
  }, [step]);

  useEffect(() => {
    if (resendAt <= Date.now()) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function requestCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending) {
      return;
    }
    // The address is read from the form itself: text typed before the page finished
    // loading (slow phone, slow browser) is in the field but not yet in React state.
    const typed = event
      ? String(new FormData(event.currentTarget).get("email") ?? "")
      : email;
    setEmail(typed);
    setPending(true);
    setFailure(null);

    const result = await apiRequest<RequestCodeData>("/api/auth/code", {
      method: "POST",
      body: { email: typed },
      csrfToken,
    });
    setPending(false);

    if (!result.ok) {
      setFailure(result);
      return;
    }
    setNotice(result.data.message);
    setNow(Date.now());
    setResendAt(Date.now() + result.data.resendAfterSeconds * 1000);
    setCode("");
    setStep("code");
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending(true);
    setFailure(null);

    const result = await apiRequest<{ account: unknown }>("/api/auth/verify", {
      method: "POST",
      body: { email, code },
      csrfToken,
    });

    if (!result.ok) {
      setPending(false);
      setFailure(result);
      codeInput.current?.focus();
      return;
    }
    // Keep the form disabled while navigating so the code cannot be re-sent.
    router.replace("/");
    router.refresh();
  }

  function changeEmail() {
    setStep("email");
    setCode("");
    setNotice(null);
    setFailure(null);
  }

  if (step === "email") {
    return (
      <form onSubmit={requestCode} noValidate className="grid gap-5 form-panel">
        <ErrorSummary failure={failure} fieldLabels={{ email: "Email" }} />
        <TextField
          id="email"
          name="email"
          type="email"
          label="Registered email address"
          hint="Registered email address; a six-digit sign-in code is sent here."
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrorFor(failure, "email")}
        />
        <Button type="submit" loading={pending} className="sm:w-fit">
          <Mail aria-hidden="true" className="size-5" />
          Send Sign-In Code
        </Button>
      </form>
    );
  }

  const codeError =
    failure?.code === "CODE_INVALID_OR_EXPIRED"
      ? "That code is not valid or has expired. Check the code, or request a new one."
      : fieldErrorFor(failure, "code");

  return (
    <div className="grid gap-5">
      <Notice tone="info" heading="Check your email">
        {notice}
      </Notice>

      <form onSubmit={verify} noValidate className="grid gap-5 form-panel">
        {failure && failure.code !== "CODE_INVALID_OR_EXPIRED" ? (
          <ErrorSummary failure={failure} fieldLabels={{ code: "Code" }} />
        ) : null}
        <TextField
          ref={codeInput}
          id="code"
          name="code"
          type="text"
          label="Six-digit code"
          hint={`Sent to ${email}; pasting is supported.`}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={CODE_LENGTH + 6}
          autoCapitalize="none"
          spellCheck={false}
          required
          className="max-w-[16rem] tracking-[0.3em] tabular-nums"
          value={code}
          onChange={(event) => setCode(normalizeCodeInput(event.target.value))}
          error={codeError}
        />
        <Button
          type="submit"
          loading={pending}
          disabled={code.length !== CODE_LENGTH}
          className="sm:w-fit"
        >
          <ShieldCheck aria-hidden="true" className="size-5" />
          Verify and Sign In
        </Button>
      </form>

      <div className="grid gap-3 border-t border-border pt-5">
        <p className="text-caption text-muted">
          {secondsLeft > 0
            ? `You can ask for a new code in about ${secondsLeft} seconds.`
            : "Did not get a code? Check spam, then ask for a new one."}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            variant="secondary"
            onClick={() => void requestCode()}
            disabled={pending || secondsLeft > 0}
          >
            Send a New Code
          </Button>
          <Button variant="secondary" onClick={changeEmail} disabled={pending}>
            Use a Different Email
          </Button>
        </div>
      </div>
    </div>
  );
}
