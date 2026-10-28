// Accessible public enquiry form retains input on failure and acknowledges provider acceptance only.
"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";
import { fieldErrorFor } from "@/shared/http/messages";

export function ContactForm({
  csrfToken,
}: Readonly<{ csrfToken: string | undefined }>) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || notice) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setFailure(null);
    const result = await apiRequest<{ message: string }>("/api/contact", {
      method: "POST",
      csrfToken,
      body: {
        name: form.get("name"),
        email: form.get("email"),
        message: form.get("message"),
      },
    });
    setPending(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setNotice(result.data.message);
  }

  if (notice)
    return (
      <Notice tone="success" heading="Message accepted">
        {notice}
      </Notice>
    );

  return (
    <form onSubmit={submit} className="grid gap-5">
      <ErrorSummary
        failure={failure}
        fieldLabels={{ name: "Name", email: "Email", message: "Message" }}
      />
      {failure &&
      (failure.status === 0 ||
        failure.status >= 500 ||
        failure.code === "INVALID_RESPONSE") ? (
        <p className="text-body text-muted">
          We could not confirm that your message was sent. Wait before retrying,
          or contact your RWA administrator directly.
        </p>
      ) : null}
      <TextField
        id="name"
        name="name"
        label="Name"
        autoComplete="name"
        required
        maxLength={100}
        error={fieldErrorFor(failure, "name")}
      />
      <TextField
        id="email"
        name="email"
        label="Reply email address"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        error={fieldErrorFor(failure, "email")}
      />
      <TextAreaField
        id="message"
        name="message"
        label="Message"
        hint="Do not include ballots, sign-in codes, passwords or identity documents."
        required
        minLength={10}
        maxLength={5000}
        error={fieldErrorFor(failure, "message")}
      />
      <p className="text-caption text-muted">
        Your details will be used to respond to this enquiry. Read our{" "}
        <Link href="/privacy" className="text-accent underline">
          privacy policy
        </Link>
        .
      </p>
      <Button
        type="submit"
        loading={pending}
        disabled={!csrfToken}
        className="sm:w-fit"
      >
        <Send aria-hidden="true" className="size-5" />
        Send Message
      </Button>
      {!csrfToken ? (
        <p role="alert" className="text-error">
          Reload this page before sending your message.
        </p>
      ) : null}
    </form>
  );
}
