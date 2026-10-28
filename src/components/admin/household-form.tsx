// Household eligibility editor; identifiers and representatives are managed from the account page.
"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { CheckboxField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useHouseholdTerms } from "@/components/ui/household-terms";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";
import type { HouseholdProjection } from "@/shared/contracts/register";

export function HouseholdForm({
  csrfToken,
  household,
}: Readonly<{
  csrfToken: string | undefined;
  household: HouseholdProjection;
}>) {
  const router = useRouter();
  const terms = useHouseholdTerms();
  const [eligible, setEligible] = useState(household.isEligible);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [unchanged, setUnchanged] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setFailure(null);
    if (eligible === household.isEligible) {
      setUnchanged(true);
      return;
    }
    setUnchanged(false);
    setPending(true);
    const result = await apiRequest<HouseholdProjection>(
      `/api/admin/households/${household.id}`,
      { method: "PATCH", body: { isEligible: eligible }, csrfToken },
    );
    setPending(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    router.push("/admin/residents?notice=household-updated");
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="grid max-w-ballot gap-6">
      <Notice tone="info" heading="Changes apply to future votes only">
        A vote that is already active keeps the electorate it started with.
      </Notice>

      <ErrorSummary failure={failure} />

      <dl className="grid gap-2 text-body">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-semibold">Representative:</dt>
          <dd>
            <Link
              href={`/admin/residents/${household.representativeAccountId}#household`}
              className="text-accent underline underline-offset-2"
            >
              {household.representative.name}
            </Link>
            {household.representative.email
              ? ` — ${household.representative.email}`
              : ""}
          </dd>
        </div>
      </dl>
      <p className="text-caption text-muted">
        To change the {terms.identifierLabel.toLowerCase()} or move this{" "}
        {terms.household} to another account, open the representative&apos;s
        account page.
      </p>

      <CheckboxField
        id="isEligible"
        name="isEligible"
        label="Eligible to vote"
        hint={`Only eligible ${terms.households} can join new votes.`}
        checked={eligible}
        onChange={(event) => setEligible(event.target.checked)}
      />

      {unchanged ? (
        <Notice tone="info">There are no changes to save.</Notice>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" loading={pending}>
          <Save aria-hidden="true" className="size-5" />
          Save Changes
        </Button>
        <Link
          href="/admin/residents"
          className="inline-flex touch-target items-center justify-center rounded-control border border-control-border bg-surface px-4 py-3 font-semibold text-primary hover:bg-primary/5"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
