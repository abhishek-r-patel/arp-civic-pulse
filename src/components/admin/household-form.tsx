"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useHouseholdTerms } from "@/components/ui/household-terms";
import type { AssignableAccount } from "@/server/register/accounts";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";
import { fieldErrorFor } from "@/shared/http/messages";
import {
  ACCOUNT_STATUS_LABELS,
  type HouseholdProjection,
} from "@/shared/contracts/register";

type HouseholdFormProps = Readonly<{
  csrfToken: string | undefined;
  accounts: readonly AssignableAccount[];
  household?: HouseholdProjection;
  identifierLabel: string;
  /** True when the account list was capped, so some accounts are not shown. */
  limited?: boolean;
  /** Unused default identifiers from RWA Settings, offered as type-ahead. */
  identifierSuggestions?: readonly string[];
}>;

// Machine-readable conflict reasons point at the field the person can fix.
function conflictField(
  failure: ApiFailure | null,
  householdLabel: string,
): {
  identifier?: string;
  representative?: string;
} {
  if (failure?.code !== "REGISTER_CONFLICT") {
    return {};
  }
  switch (failure.context.reason) {
    case "DUPLICATE_IDENTIFIER":
      return {
        identifier: "This value is already in use.",
      };
    case "REPRESENTATIVE_ASSIGNED":
      return {
        representative: `This account already represents another ${householdLabel}. Choose a different account.`,
      };
    case "REPRESENTATIVE_DELETED":
      return {
        representative: `This account has been deleted and cannot represent the selected ${householdLabel}.`,
      };
    default:
      return {};
  }
}

function optionLabel(account: AssignableAccount): string {
  const email = account.email ?? "email unavailable";
  const status =
    account.status === "ENABLED"
      ? ""
      : ` (${ACCOUNT_STATUS_LABELS[account.status]})`;
  return `${account.name} — ${email}${status}`;
}

export function HouseholdForm({
  csrfToken,
  accounts,
  household,
  identifierLabel,
  limited = false,
  identifierSuggestions = [],
}: HouseholdFormProps) {
  const router = useRouter();
  const terms = useHouseholdTerms();
  const editing = household !== undefined;

  const [identifier, setIdentifier] = useState(household?.identifier ?? "");
  const [representative, setRepresentative] = useState(
    household?.representativeAccountId ?? "",
  );
  const [eligible, setEligible] = useState(household?.isEligible ?? false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [unchanged, setUnchanged] = useState(false);
  const [pending, setPending] = useState(false);

  if (!editing && accounts.length === 0) {
    return (
      <Notice tone="warning" heading="No account is available to assign">
        <p>
          Every account already represents one {terms.household}. Create an
          account for the resident first, then come back to add another.
        </p>
        <p className="pt-2">
          <Link
            href="/admin/accounts/new"
            className="font-semibold text-accent underline underline-offset-2"
          >
            Create an account
          </Link>
        </p>
      </Notice>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setFailure(null);
    setUnchanged(false);

    let result;
    if (household) {
      const changes: Record<string, unknown> = {};
      if (identifier.trim() !== household.identifier) {
        changes.identifier = identifier;
      }
      if (representative !== household.representativeAccountId) {
        changes.representativeAccountId = representative;
      }
      if (eligible !== household.isEligible) {
        changes.isEligible = eligible;
      }
      if (Object.keys(changes).length === 0) {
        setUnchanged(true);
        return;
      }
      setPending(true);
      result = await apiRequest<HouseholdProjection>(
        `/api/admin/households/${household.id}`,
        { method: "PATCH", body: changes, csrfToken },
      );
    } else {
      setPending(true);
      result = await apiRequest<HouseholdProjection>("/api/admin/households", {
        method: "POST",
        body: {
          identifier,
          representativeAccountId: representative,
          isEligible: eligible,
        },
        csrfToken,
      });
    }
    setPending(false);

    if (!result.ok) {
      setFailure(result);
      return;
    }
    router.push(
      `/admin/households?notice=${editing ? "household-updated" : "household-created"}`,
    );
    router.refresh();
  }

  const conflict = conflictField(failure, terms.household);
  const fieldErrors = {
    identifier: fieldErrorFor(failure, "identifier") ?? conflict.identifier,
    representative:
      fieldErrorFor(failure, "representativeAccountId") ??
      conflict.representative,
  };

  return (
    <form onSubmit={submit} noValidate className="grid max-w-ballot gap-6">
      <Notice tone="info" heading="Changes apply to future votes only">
        A vote that is already active keeps the representative and the{" "}
        {terms.household} name it started with, even if you edit them here.
      </Notice>

      <ErrorSummary
        failure={failure}
        fieldLabels={{
          identifier: identifierLabel,
          representativeAccountId: "Representative",
        }}
      />

      {limited ? (
        <Notice tone="warning" heading="The account list is not complete">
          <p>
            Only the {accounts.length} most recently created accounts with no{" "}
            {terms.household} assignment are listed. If the account you need is
            missing, assign the older accounts first.
          </p>
        </Notice>
      ) : null}

      <TextField
        id="identifier"
        name="identifier"
        label={identifierLabel}
        hint={`Enter the value assigned to this ${terms.household}. Letter case and extra spaces do not make two identifiers different.${identifierSuggestions.length > 0 ? ` Start typing to pick from the ${identifierSuggestions.length} default ${identifierSuggestions.length === 1 ? terms.household : terms.households} not yet added.` : ""}`}
        required
        maxLength={100}
        autoComplete="off"
        list={
          identifierSuggestions.length > 0
            ? "identifier-suggestions"
            : undefined
        }
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        error={fieldErrors.identifier}
      />
      {identifierSuggestions.length > 0 ? (
        <datalist id="identifier-suggestions">
          {identifierSuggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}

      <SelectField
        id="representativeAccountId"
        name="representativeAccountId"
        label="Representative"
        hint={`The one account that votes for this ${terms.household}. A newly created account stays suspended until you enable it.`}
        required
        value={representative}
        onChange={(event) => setRepresentative(event.target.value)}
        error={fieldErrors.representative}
      >
        <option value="">Choose an account…</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {optionLabel(account)}
          </option>
        ))}
      </SelectField>

      <CheckboxField
        id="isEligible"
        name="isEligible"
        label="Eligible to vote"
        hint={`Only eligible ${terms.households} can be included in a new vote.`}
        checked={eligible}
        onChange={(event) => setEligible(event.target.checked)}
      />

      {unchanged ? (
        <Notice tone="info">There are no changes to save.</Notice>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" loading={pending}>
          <Save aria-hidden="true" className="size-5" />
          {editing ? "Save Changes" : `Add ${terms.Household}`}
        </Button>
        <Link
          href="/admin/households"
          className="inline-flex touch-target items-center justify-center rounded-control border border-control-border bg-surface px-4 py-3 font-semibold text-primary hover:bg-primary/5"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
