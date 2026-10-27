// Client-side account provisioning and profile-management forms.
"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Save, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorSummary } from "@/components/ui/error-summary";
import { SelectField, TextField } from "@/components/ui/field";
import { AccountStatusBadge, RoleBadge } from "@/components/ui/badges";
import { Notice } from "@/components/ui/notice";
import { useHouseholdTerms } from "@/components/ui/household-terms";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";
import { fieldErrorFor } from "@/shared/http/messages";
import type {
  AccountProjection,
  AccountStatus,
} from "@/shared/contracts/register";

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

export function AccountCreateForm({
  csrfToken,
}: Readonly<{ csrfToken: string | undefined }>) {
  const router = useRouter();
  const terms = useHouseholdTerms();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isReadonly, setIsReadonly] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending(true);
    setFailure(null);

    const result = await apiRequest<AccountProjection>("/api/admin/accounts", {
      method: "POST",
      body: { email, representativeName: name, isAdmin, isReadonly },
      csrfToken,
    });
    setPending(false);

    if (!result.ok) {
      setFailure(result);
      return;
    }
    router.push(`/admin/accounts/${result.data.id}?notice=account-created`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="grid max-w-ballot gap-6">
      <Notice tone="info" heading="The account starts suspended">
        It cannot be used until a resident has an assigned {terms.household} and
        you enable it. An administrator account can be enabled without one.
      </Notice>

      <ErrorSummary failure={failure} fieldLabels={FIELD_LABELS} />

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
        hint={`Roles do not confer voting eligibility. RWA ReadOnly requires an assigned ${terms.household} before enablement.`}
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

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" loading={pending}>
          <UserPlus aria-hidden="true" className="size-5" />
          Create Account
        </Button>
        <Link
          href="/admin/accounts"
          className="inline-flex touch-target items-center justify-center rounded-control border border-control-border bg-surface px-4 py-3 font-semibold text-primary hover:bg-primary/5"
        >
          Cancel
        </Link>
      </div>
    </form>
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
    account.status === "SUSPENDED" &&
    failure?.code === "PROVISIONING_INCOMPLETE";

  return (
    <div className="grid max-w-ballot gap-8">
      {saved ? (
        <Notice tone="success" heading={saved}>
          {account.status === "SUSPENDED" && !account.isAdmin
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
              <Link
                href="/admin/households/new"
                className="font-semibold text-accent underline underline-offset-2"
              >
                Add {terms.Household}
              </Link>
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
          hint={`Roles do not confer voting eligibility. RWA ReadOnly requires an assigned ${terms.household} before enablement.`}
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
              href="/admin/accounts"
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
