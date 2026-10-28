// Combined resident provisioning (household required for voters) and profile-management forms.
"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Home, Save, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComboboxField } from "@/components/ui/combobox-field";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorSummary } from "@/components/ui/error-summary";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import {
  AccountStatusBadge,
  EligibilityBadge,
  RoleBadge,
} from "@/components/ui/badges";
import { Notice } from "@/components/ui/notice";
import { useHouseholdTerms } from "@/components/ui/household-terms";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";
import { fieldErrorFor } from "@/shared/http/messages";
import type {
  AccountHousehold,
  AccountProjection,
  AccountStatus,
  HouseholdChoices,
} from "@/shared/contracts/register";
import { settingsListKey } from "@/shared/contracts/rwa-profile";

const FIELD_LABELS = {
  email: "Email address",
  representativeName: "Representative name",
};

function duplicateEmail(failure: ApiFailure | null): string | undefined {
  return failure?.code === "REGISTER_CONFLICT" &&
    failure.context.reason === "DUPLICATE_EMAIL"
    ? "Another account already uses this email address."
    : undefined;
}

/*
 * Household input shared by the create form and the account page. With Default
 * Households configured only listed, unassigned entries can be chosen;
 * otherwise the identifier is typed.
 */
function HouseholdPicker({
  id,
  choices,
  value,
  onChange,
  onTextChange,
  required = false,
  hint,
  error,
}: Readonly<{
  id: string;
  choices: HouseholdChoices;
  value: string;
  onChange: (value: string) => void;
  onTextChange: (text: string) => void;
  required?: boolean;
  hint: string;
  error?: string | undefined;
}>) {
  const terms = useHouseholdTerms();
  if (choices.listed && choices.options.length === 0) {
    return (
      <Notice tone="warning" heading={`No unassigned ${terms.households}`}>
        Every {terms.household} in Settings → Default {terms.Households} is
        already assigned. Add more there first.
        {error ? <p role="alert">{error}</p> : null}
      </Notice>
    );
  }
  return choices.listed ? (
    <ComboboxField
      id={id}
      name={id}
      label={terms.identifierLabel}
      hint={`${hint} Start typing or open the list; only unassigned entries from Settings → Default ${terms.Households} can be chosen.`}
      required={required}
      options={choices.options}
      value={value}
      onChange={onChange}
      onTextChange={onTextChange}
      matchKey={settingsListKey}
      error={error}
    />
  ) : (
    <TextField
      id={id}
      name={id}
      label={terms.identifierLabel}
      hint={`${hint} Letter case and extra spaces do not make two identifiers different.`}
      required={required}
      maxLength={100}
      autoComplete="off"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
        onTextChange(event.target.value);
      }}
      error={error}
    />
  );
}

export function AccountCreateForm({
  csrfToken,
  choices,
}: Readonly<{ csrfToken: string | undefined; choices: HouseholdChoices }>) {
  const router = useRouter();
  const terms = useHouseholdTerms();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isReadonly, setIsReadonly] = useState(false);
  const [household, setHousehold] = useState("");
  const [householdText, setHouseholdText] = useState("");
  const [eligible, setEligible] = useState(false);
  const [enable, setEnable] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [pending, setPending] = useState(false);

  const identifier = household.trim();
  const canEnable = isAdmin || isReadonly || identifier !== "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    if (!isAdmin && !isReadonly && !identifier) {
      setPickError(
        `Choose a ${terms.identifierLabel} before creating a resident.`,
      );
      document.getElementById("household.identifier")?.focus();
      return;
    }
    // Typed text never turned into a list choice must not silently become "no household".
    if (choices.listed && householdText.trim() !== "" && !identifier) {
      setPickError(
        `Choose a ${terms.identifierLabel} from the list, or clear the field to assign one later.`,
      );
      document.getElementById("household.identifier")?.focus();
      return;
    }
    setPickError(null);
    setPending(true);
    setFailure(null);

    const result = await apiRequest<AccountProjection>("/api/admin/accounts", {
      method: "POST",
      body: {
        email,
        representativeName: name,
        isAdmin,
        isReadonly,
        ...(identifier
          ? { household: { identifier, isEligible: eligible } }
          : {}),
        enable: enable && canEnable,
      },
      csrfToken,
    });
    setPending(false);

    if (!result.ok) {
      setFailure(result);
      return;
    }
    const notice =
      enable && canEnable && result.data.status !== "ENABLED"
        ? "account-created-not-enabled"
        : result.data.status === "ENABLED"
          ? "account-created-enabled"
          : "account-created";
    router.push(`/admin/residents/${result.data.id}?notice=${notice}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="grid max-w-ballot gap-6">
      <Notice tone="info" heading="Add the resident and their home together">
        Choose the person&apos;s {terms.household} here. A {terms.household} is
        required for a voter; management-role accounts can leave it blank. The
        account stays suspended unless you tick Enable account now. Account
        access and voting eligibility are separate approvals.
      </Notice>

      <ErrorSummary
        failure={failure}
        fieldLabels={{
          ...FIELD_LABELS,
          "household.identifier": terms.identifierLabel,
          enable: "Enable account now",
        }}
      />

      <TextField
        id="email"
        name="email"
        type="email"
        label="Email address"
        hint="The address the resident will sign in with. It is not stored in the register; it is kept by the sign-in service."
        required
        autoComplete="off"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={fieldErrorFor(failure, "email") ?? duplicateEmail(failure)}
      />
      <TextField
        id="representativeName"
        name="representativeName"
        label="Representative name"
        hint="Shown in completed PUBLIC vote results."
        required
        maxLength={200}
        autoComplete="off"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={fieldErrorFor(failure, "representativeName")}
      />
      <SelectField
        id="managementRole"
        label="Management role"
        hint={`Roles never confer voting. Anyone who should vote, including an RWA Admin or RWA ReadOnly, needs their own eligible ${terms.household}; residents need one before enablement.`}
        value={isAdmin ? "rwa-admin" : isReadonly ? "rwa-readonly" : "voter"}
        onChange={(event) => {
          setIsAdmin(event.target.value === "rwa-admin");
          setIsReadonly(event.target.value === "rwa-readonly");
        }}
      >
        <option value="voter">Voter (voter)</option>
        <option value="rwa-admin">RWA Admin (rwa-admin)</option>
        <option value="rwa-readonly">RWA ReadOnly (rwa-readonly)</option>
      </SelectField>

      <fieldset className="grid gap-4">
        <legend className="pb-2 text-section font-semibold">
          {terms.Household}
        </legend>
        <HouseholdPicker
          id="household.identifier"
          choices={choices}
          value={household}
          onChange={(next) => {
            setHousehold(next);
            if (next) setPickError(null);
          }}
          onTextChange={setHouseholdText}
          required={!isAdmin && !isReadonly}
          hint={`The ${terms.household} this person votes for. Required for voters; optional for management roles.`}
          error={pickError ?? fieldErrorFor(failure, "household.identifier")}
        />
        <CheckboxField
          id="isEligible"
          name="isEligible"
          label="Eligible to vote"
          hint={`Only eligible ${terms.households} can be included in a new vote.`}
          checked={eligible && identifier !== ""}
          disabled={identifier === ""}
          onChange={(event) => setEligible(event.target.checked)}
        />
      </fieldset>

      <CheckboxField
        id="enable"
        name="enable"
        label="Enable account now"
        hint={
          canEnable
            ? "The person can sign in straight away. Leave unticked to review first."
            : `Choose a ${terms.household} first; residents cannot be enabled without one.`
        }
        checked={enable && canEnable}
        disabled={!canEnable}
        onChange={(event) => setEnable(event.target.checked)}
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" loading={pending}>
          <UserPlus aria-hidden="true" className="size-5" />
          Create Resident
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

/*
 * Assigns a household to an account without one, or moves the account to another
 * unassigned household. Moving renames the existing household record, keeping its
 * eligibility and freeing the old identifier for another account.
 */
export function AccountHouseholdSection({
  csrfToken,
  accountId,
  household,
  choices,
  disabled,
}: Readonly<{
  csrfToken: string | undefined;
  accountId: string;
  household: AccountHousehold | null;
  choices: HouseholdChoices;
  disabled: boolean;
}>) {
  const router = useRouter();
  const terms = useHouseholdTerms();
  const [value, setValue] = useState("");
  const [text, setText] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Choosing the current household again is not a change.
  const options = household
    ? {
        ...choices,
        options: choices.options.filter(
          (item) =>
            settingsListKey(item) !== settingsListKey(household.identifier),
        ),
      }
    : choices;

  async function save() {
    setPending(true);
    setFailure(null);
    setSaved(null);
    const result = await apiRequest<AccountHousehold>(
      `/api/admin/accounts/${accountId}/household`,
      { method: "PUT", body: { identifier: value.trim() }, csrfToken },
    );
    setPending(false);
    setConfirming(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setSaved(
      household
        ? `Moved to ${result.data.identifier}. ${household.identifier} is now free for another account.`
        : `${terms.Household} ${result.data.identifier} assigned.`,
    );
    setValue("");
    setText("");
    router.refresh();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!value.trim()) {
      setPickError(
        choices.listed && text.trim()
          ? `Choose a ${terms.identifierLabel} from the list.`
          : `Enter a ${terms.identifierLabel}.`,
      );
      document.getElementById("identifier")?.focus();
      return;
    }
    setPickError(null);
    if (household) {
      setConfirming(true);
      return;
    }
    void save();
  }

  return (
    <section
      id="household"
      aria-labelledby="household-heading"
      className="grid max-w-ballot gap-4 border-t border-border pt-8"
    >
      <h2 id="household-heading" className="text-section font-semibold">
        {terms.Household}
      </h2>
      {saved ? <Notice tone="success">{saved}</Notice> : null}
      {household ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-body font-semibold">
            {household.identifier}
          </span>
          <EligibilityBadge eligible={household.isEligible} />
          <Link
            href={`/admin/residents/households/${household.id}`}
            className="font-semibold text-accent underline underline-offset-2"
          >
            Change eligibility
          </Link>
        </div>
      ) : (
        <p className="text-body text-muted">
          No {terms.household} is assigned yet.
        </p>
      )}
      {disabled ? null : (
        <form onSubmit={submit} noValidate className="grid gap-4">
          <ErrorSummary
            failure={failure}
            fieldLabels={{ identifier: terms.identifierLabel }}
          />
          <HouseholdPicker
            key={household?.identifier ?? "none"}
            id="identifier"
            choices={options}
            value={value}
            onChange={(next) => {
              setValue(next);
              if (next) setPickError(null);
            }}
            onTextChange={setText}
            required
            hint={
              household
                ? `Move this account to another ${terms.household}. Past and active votes keep the ${terms.household} they were frozen with; eligibility stays as it is.`
                : `Assign the ${terms.household} this person votes for. It starts not eligible.`
            }
            error={pickError ?? fieldErrorFor(failure, "identifier")}
          />
          <Button type="submit" loading={pending} className="sm:w-fit">
            <Home aria-hidden="true" className="size-5" />
            {household
              ? `Move ${terms.Household}`
              : `Assign ${terms.Household}`}
          </Button>
        </form>
      )}
      <ConfirmDialog
        open={confirming}
        title={`Move to ${value.trim()}?`}
        confirmLabel={`Move ${terms.Household}`}
        destructive={false}
        busy={pending}
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      >
        <p>
          {household?.identifier} will be renamed to {value.trim()} for this
          account, keeping its voting eligibility. {household?.identifier} then
          becomes free to assign to a new account. Active and past votes keep
          the {terms.household} they started with.
        </p>
      </ConfirmDialog>
    </section>
  );
}

type PendingAction =
  { kind: "save" } | { kind: "status"; status: AccountStatus };

export function AccountEditor({
  csrfToken,
  account: initial,
  flash,
}: Readonly<{
  csrfToken: string | undefined;
  account: AccountProjection;
  flash?: string | undefined;
}>) {
  const router = useRouter();
  const terms = useHouseholdTerms();
  const [account, setAccount] = useState(initial);
  const [email, setEmail] = useState(initial.email ?? "");
  const [name, setName] = useState(initial.representativeName);
  const [isAdmin, setIsAdmin] = useState(initial.isAdmin);
  const [isReadonly, setIsReadonly] = useState(initial.isReadonly === true);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [saved, setSaved] = useState<string | null>(flash ?? null);
  const [unchanged, setUnchanged] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<PendingAction | null>(null);

  // A refresh brings newer server data (for example after a partly applied
  // email change): adopt it without clearing the confirmation message.
  const [seenVersion, setSeenVersion] = useState(initial.updatedAt);
  if (initial.updatedAt !== seenVersion) {
    setSeenVersion(initial.updatedAt);
    setAccount(initial);
    setEmail(initial.email ?? "");
    setName(initial.representativeName);
    setIsAdmin(initial.isAdmin);
    setIsReadonly(initial.isReadonly === true);
  }

  const deleted = account.status === "DELETED";

  function pendingChanges(): Record<string, unknown> {
    const changes: Record<string, unknown> = {};
    if (name.trim() !== account.representativeName) {
      changes.representativeName = name;
    }
    if (email.trim().toLowerCase() !== (account.email ?? "")) {
      changes.email = email;
    }
    if (isAdmin !== account.isAdmin) {
      changes.isAdmin = isAdmin;
    }
    if (
      isReadonly !== (account.isReadonly === true) ||
      isAdmin !== account.isAdmin
    ) {
      changes.isReadonly = isReadonly;
      changes.isAdmin = isAdmin;
    }
    return changes;
  }

  async function patch(changes: Record<string, unknown>) {
    setPending(true);
    setFailure(null);
    setSaved(null);
    setUnchanged(false);

    const result = await apiRequest<AccountProjection>(
      `/api/admin/accounts/${account.id}`,
      { method: "PATCH", body: changes, csrfToken },
    );
    setPending(false);
    setConfirm(null);

    if (!result.ok) {
      setFailure(result);
      // A partly applied change may have left the account suspended: reload the truth.
      if (result.code === "PROVISIONING_INCOMPLETE") {
        router.refresh();
      }
      return;
    }
    setAccount(result.data);
    setEmail(result.data.email ?? "");
    setName(result.data.representativeName);
    setIsAdmin(result.data.isAdmin);
    setIsReadonly(result.data.isReadonly === true);
    setSaved("Account updated.");
    router.refresh();
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    const changes = pendingChanges();
    if (Object.keys(changes).length === 0) {
      setUnchanged(true);
      setSaved(null);
      return;
    }
    // Consequential changes get an explicit confirmation first.
    if ("email" in changes || (account.isAdmin && !isAdmin)) {
      setConfirm({ kind: "save" });
      return;
    }
    void patch(changes);
  }

  const emailChanging = "email" in pendingChanges();
  const demoting = account.isAdmin && !isAdmin;

  function dialogContent() {
    if (!confirm) {
      return null;
    }
    if (confirm.kind === "save") {
      return {
        title: "Confirm these changes",
        confirmLabel: "Save Changes",
        destructive: false,
        body: (
          <>
            {emailChanging ? (
              <p>
                Changing the email address briefly suspends this account while
                the sign-in service is updated. If the account was enabled it is
                enabled again once the new address is confirmed. If anything
                fails it stays suspended and you will be told.
              </p>
            ) : null}
            {demoting ? (
              <p>
                This person will stop being an administrator. At least one
                enabled administrator must always remain.
              </p>
            ) : null}
          </>
        ),
        run: () => patch(pendingChanges()),
      };
    }
    if (confirm.status === "SUSPENDED") {
      return {
        title: "Suspend this account?",
        confirmLabel: "Suspend Account",
        destructive: true,
        body: (
          <p>
            {account.representativeName} will be blocked from Civic Pulse
            straight away, even if they are signed in. Votes they already took
            part in are not affected. You can enable the account again later.
          </p>
        ),
        run: () => patch({ status: "SUSPENDED" }),
      };
    }
    if (confirm.status === "DELETED") {
      return {
        title: "Delete this account?",
        confirmLabel: "Delete Account",
        destructive: true,
        body: (
          <>
            <p>
              {account.representativeName} will be blocked permanently. This
              cannot be undone, and the account cannot be restored.
            </p>
            <p>
              Their name stays in past records, and any {terms.household} they
              represent keeps its assignment until you change it.
            </p>
          </>
        ),
        run: () => patch({ status: "DELETED" }),
      };
    }
    return {
      title: "Enable this account?",
      confirmLabel: "Enable Account",
      destructive: false,
      body: (
        <p>
          {account.representativeName} will be able to sign in. A resident must
          be assigned to the {terms.household} first.
        </p>
      ),
      run: () => patch({ status: "ENABLED" }),
    };
  }

  const dialog = dialogContent();
  const residentWithoutHousehold =
    !account.isAdmin &&
    account.isReadonly !== true &&
    account.status === "SUSPENDED" &&
    failure?.code === "PROVISIONING_INCOMPLETE";

  return (
    <div className="grid max-w-ballot gap-8">
      {saved ? (
        <Notice tone="success" heading={saved}>
          {account.status === "SUSPENDED" &&
          !account.isAdmin &&
          account.isReadonly !== true
            ? `Assign a ${terms.household}, then enable the account so this resident can sign in.`
            : "Your change was saved."}
        </Notice>
      ) : null}

      <section aria-labelledby="status-heading" className="grid gap-3">
        <h2 id="status-heading" className="text-section font-semibold">
          Status
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <AccountStatusBadge status={account.status} />
          <RoleBadge
            isAdmin={account.isAdmin}
            isReadonly={account.isReadonly}
            isAppSupport={account.isAppSupport}
          />
        </div>
        {deleted ? (
          <p className="text-body text-muted">
            This account was deleted. It can no longer be changed.
          </p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row">
            {account.status === "SUSPENDED" ? (
              <Button
                onClick={() =>
                  setConfirm({ kind: "status", status: "ENABLED" })
                }
                disabled={pending}
              >
                Enable Account
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() =>
                  setConfirm({ kind: "status", status: "SUSPENDED" })
                }
                disabled={pending}
              >
                Suspend Account
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => setConfirm({ kind: "status", status: "DELETED" })}
              disabled={pending}
            >
              Delete Account
            </Button>
          </div>
        )}
        {residentWithoutHousehold ? (
          <Notice tone="warning" heading={`${terms.Household} needed first`}>
            <p>
              Residents can only be enabled once a {terms.household} is assigned
              to them.{" "}
              <a
                href="#household"
                className="font-semibold text-accent underline underline-offset-2"
              >
                Assign a {terms.Household}
              </a>
              , then enable this account.
            </p>
          </Notice>
        ) : null}
      </section>

      <form onSubmit={save} noValidate className="grid gap-6">
        <h2 className="text-section font-semibold">Details</h2>
        <ErrorSummary
          failure={residentWithoutHousehold ? null : failure}
          fieldLabels={FIELD_LABELS}
        />

        <TextField
          id="representativeName"
          name="representativeName"
          label="Representative name"
          required
          maxLength={200}
          autoComplete="off"
          disabled={deleted}
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={fieldErrorFor(failure, "representativeName")}
        />
        <TextField
          id="email"
          name="email"
          type="email"
          label="Email address"
          hint={
            account.emailVerifiedAt
              ? "Verified by the sign-in service."
              : "Not yet verified by the sign-in service."
          }
          required
          autoComplete="off"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          disabled={deleted}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrorFor(failure, "email") ?? duplicateEmail(failure)}
        />
        <SelectField
          id="managementRole"
          label="Management role"
          hint={`Roles never confer voting. Anyone who should vote, including an RWA Admin or RWA ReadOnly, needs their own eligible ${terms.household}; residents need one before enablement.`}
          disabled={deleted}
          value={isAdmin ? "rwa-admin" : isReadonly ? "rwa-readonly" : "voter"}
          onChange={(event) => {
            setIsAdmin(event.target.value === "rwa-admin");
            setIsReadonly(event.target.value === "rwa-readonly");
          }}
        >
          <option value="voter">Voter (voter)</option>
          <option value="rwa-admin">RWA Admin (rwa-admin)</option>
          <option value="rwa-readonly">RWA ReadOnly (rwa-readonly)</option>
        </SelectField>

        {unchanged ? (
          <Notice tone="info">There are no changes to save.</Notice>
        ) : null}

        {deleted ? null : (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" loading={pending}>
              <Save aria-hidden="true" className="size-5" />
              Save Changes
            </Button>
            <Link
              href="/admin/residents"
              className="inline-flex touch-target items-center justify-center rounded-control border border-control-border bg-surface px-4 py-3 font-semibold text-primary hover:bg-primary/5"
            >
              Back to accounts
            </Link>
          </div>
        )}
      </form>

      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ""}
        confirmLabel={dialog?.confirmLabel ?? ""}
        destructive={dialog?.destructive ?? false}
        busy={pending}
        onConfirm={() => void dialog?.run()}
        onCancel={() => setConfirm(null)}
      >
        {dialog?.body}
      </ConfirmDialog>
    </div>
  );
}
