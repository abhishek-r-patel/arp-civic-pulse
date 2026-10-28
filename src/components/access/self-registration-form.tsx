// Accessible public self-registration form; success never implies the account is usable yet.
"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComboboxField } from "@/components/ui/combobox-field";
import { ErrorSummary } from "@/components/ui/error-summary";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import type { HouseholdTerms } from "@/shared/contracts/household-terms";
import { settingsListKey } from "@/shared/contracts/rwa-profile";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";
import { fieldErrorFor } from "@/shared/http/messages";

export function SelfRegistrationForm({
  csrfToken,
  terms,
  households,
}: Readonly<{
  csrfToken: string | undefined;
  terms: HouseholdTerms;
  /** RWA Default Households; empty means free-text entry. */
  households: readonly string[];
}>) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [household, setHousehold] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || notice) return;
    if (households.length > 0 && !household) {
      setPickError(`Choose your ${terms.identifierLabel} from the list.`);
      document.getElementById("identifier")?.focus();
      return;
    }
    setPickError(null);
    const form = new FormData(event.currentTarget);
    setPending(true);
    setFailure(null);
    const result = await apiRequest<{ message: string }>("/api/register", {
      method: "POST",
      csrfToken,
      body: {
        representativeName: form.get("representativeName"),
        email: form.get("email"),
        identifier: form.get("identifier"),
        website: form.get("website") ?? "",
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
      <Notice tone="success" heading="Registration received">
        <p>{notice}</p>
        <p className="pt-2">
          You will be able to{" "}
          <a href="/sign-in" className="text-accent underline">
            sign in
          </a>{" "}
          once your account is enabled.
        </p>
      </Notice>
    );

  return (
    <form onSubmit={submit} className="grid gap-5">
      <ErrorSummary
        failure={failure}
        fieldLabels={{
          representativeName: "Full name",
          email: "Email address",
          identifier: terms.identifierLabel,
        }}
      />
      <TextField
        id="representativeName"
        name="representativeName"
        label="Full name"
        autoComplete="name"
        required
        maxLength={200}
        error={fieldErrorFor(failure, "representativeName")}
      />
      <TextField
        id="email"
        name="email"
        label="Email address"
        hint="Sign-in codes are sent here once your account is enabled."
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        error={fieldErrorFor(failure, "email")}
      />
      {households.length > 0 ? (
        <ComboboxField
          id="identifier"
          name="identifier"
          label={terms.identifierLabel}
          hint={`Start typing or open the list, then choose your ${terms.identifierLabel}.`}
          required
          options={households}
          value={household}
          onChange={(next) => {
            setHousehold(next);
            if (next) setPickError(null);
          }}
          matchKey={settingsListKey}
          error={pickError ?? fieldErrorFor(failure, "identifier")}
        />
      ) : (
        <TextField
          id="identifier"
          name="identifier"
          label={terms.identifierLabel}
          hint={`Enter your ${terms.identifierLabel} exactly as your RWA uses it.`}
          required
          maxLength={100}
          error={fieldErrorFor(failure, "identifier")}
        />
      )}
      {/* Honeypot: hidden from people and assistive technology; bots that fill it are ignored. */}
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] h-px w-px overflow-hidden"
      >
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <p className="text-caption text-muted">
        Your account starts suspended. Your RWA administrator checks your
        details, then enables your account and decides your voting eligibility.
        Read our{" "}
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
        <UserPlus aria-hidden="true" className="size-5" />
        Register
      </Button>
      {!csrfToken ? (
        <p role="alert" className="text-error">
          Reload this page before registering.
        </p>
      ) : null}
    </form>
  );
}
