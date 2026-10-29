// Inline household eligibility editor; existing electorates stay frozen.
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { CheckboxField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useHouseholdTerms } from "@/components/ui/household-terms";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";
import type {
  AccountHousehold,
  HouseholdProjection,
} from "@/shared/contracts/register";

type HouseholdFormProps = Readonly<{
  csrfToken: string | undefined;
  household: AccountHousehold;
  onCancel: () => void;
  onSaved: () => void;
}>;

export function HouseholdForm(props: HouseholdFormProps) {
  const { csrfToken, household } = props;
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
    props.onSaved();
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Voting eligibility"
      className="grid gap-4"
    >
      <Notice tone="info" heading="Changes apply to future votes only">
        A vote that is already active keeps the electorate it started with.
      </Notice>

      <ErrorSummary failure={failure} />

      <CheckboxField
        id="isEligible"
        name="isEligible"
        label="Eligible to vote"
        hint={`Only eligible ${terms.households} can join new votes.`}
        checked={eligible}
        disabled={pending}
        onChange={(event) => setEligible(event.target.checked)}
      />

      {unchanged ? (
        <Notice tone="info">There are no changes to save.</Notice>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button type="submit" loading={pending}>
          <Save aria-hidden="true" className="size-5" />
          Save Changes
        </Button>
        <Button variant="secondary" disabled={pending} onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
