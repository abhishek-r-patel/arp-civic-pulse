/* Page-scoped review with independent, confirmed account-access and flat-eligibility actions. */
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCheck, UserCheck } from "lucide-react";
import { formatInstant } from "@/components/admin/format";
import {
  AccountStatusBadge,
  EligibilityBadge,
  RoleBadge,
} from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Notice } from "@/components/ui/notice";
import { useHouseholdTerms } from "@/components/ui/household-terms";
import {
  accountReviewTargets,
  canReviewAccount,
  type AccountReviewAction,
  type ReviewAccountProjection,
} from "@/shared/contracts/register";
import { apiRequest } from "@/shared/http/api-client";

export function AccountReviewTable({
  accounts: initial,
  csrfToken,
}: Readonly<{
  accounts: ReviewAccountProjection[];
  csrfToken: string | undefined;
}>) {
  const terms = useHouseholdTerms();
  const router = useRouter();
  const [accounts, setAccounts] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<AccountReviewAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [completed, setCompleted] = useState(0);
  const mounted = useRef(true);
  const selectPage = useRef<HTMLInputElement>(null);
  const version = initial
    .map(
      (account) =>
        `${account.id}:${account.updatedAt}:${account.household?.id}:${account.household?.isEligible}`,
    )
    .join("|");
  const [seenVersion, setSeenVersion] = useState(version);
  if (seenVersion !== version) {
    setSeenVersion(version);
    setAccounts(initial);
    setSelected(
      (current) =>
        new Set(
          initial
            .filter(
              (account) =>
                current.has(account.id) &&
                (canReviewAccount(account, "enable") ||
                  canReviewAccount(account, "eligible")),
            )
            .map((account) => account.id),
        ),
    );
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selectable = accounts.filter(
    (account) =>
      canReviewAccount(account, "enable") ||
      canReviewAccount(account, "eligible"),
  );
  const allSelected =
    selectable.length > 0 &&
    selectable.every((account) => selected.has(account.id));
  useEffect(() => {
    if (selectPage.current)
      selectPage.current.indeterminate = selected.size > 0 && !allSelected;
  }, [selected.size, allSelected]);
  const enable = accountReviewTargets(accounts, selected, "enable");
  const eligible = accountReviewTargets(accounts, selected, "eligible");
  const targets = action === "enable" ? enable : eligible;

  async function run() {
    if (!action || busy) return;
    const operation = action;
    const pending = [...targets];
    setBusy(true);
    setProblem(null);
    setOutcomes([]);
    setCompleted(0);
    for (const account of pending) {
      if (!mounted.current) return;
      const path =
        operation === "enable"
          ? `/api/admin/accounts/${account.id}`
          : `/api/admin/households/${account.household?.id}`;
      const result = await apiRequest(path, {
        method: "PATCH",
        csrfToken,
        body:
          operation === "enable" ? { status: "ENABLED" } : { isEligible: true },
      });
      if (!mounted.current) return;
      if (!result.ok) {
        setProblem(
          `${account.representativeName}: ${result.message} Processing stopped; this account may be partly or fully updated. Completed rows are not rolled back. Refresh and review before retrying. Reference: ${result.requestId ?? result.code}.`,
        );
        break;
      }
      setAccounts((rows) =>
        rows.map((row) =>
          row.id !== account.id
            ? row
            : operation === "enable"
              ? { ...row, status: "ENABLED" }
              : {
                  ...row,
                  household: row.household
                    ? { ...row.household, isEligible: true }
                    : null,
                },
        ),
      );
      setCompleted((count) => count + 1);
      setOutcomes((rows) => [
        ...rows,
        `${account.representativeName}: ${operation === "enable" ? "Account enabled" : `${terms.Household} eligible for future votes`}.`,
      ]);
    }
    setBusy(false);
    setAction(null);
    setSelected(new Set());
    router.refresh();
  }

  const columns: Column<ReviewAccountProjection>[] = [
    {
      key: "select",
      header: "Select",
      cell: (account) => (
        <label className="inline-flex touch-target items-center gap-2">
          <input
            type="checkbox"
            aria-label={`Select ${account.representativeName}`}
            className="size-5 accent-accent"
            checked={selected.has(account.id)}
            disabled={
              busy ||
              (!canReviewAccount(account, "enable") &&
                !canReviewAccount(account, "eligible"))
            }
            onChange={(event) => {
              const checked = event.target.checked;
              setSelected((current) => {
                const next = new Set(current);
                if (checked) next.add(account.id);
                else next.delete(account.id);
                return next;
              });
            }}
          />
          <span className="sr-only">{account.representativeName}</span>
        </label>
      ),
    },
    {
      key: "name",
      header: "Representative",
      cell: (account) => (
        <span className="grid gap-1">
          <span className="font-semibold">{account.representativeName}</span>
          <span className="text-caption break-all text-muted">
            {account.email ?? "Email unavailable"}
            {account.email && !account.emailVerifiedAt ? " - not verified" : ""}
          </span>
          {account.selfRegistered ? (
            <span className="text-caption font-semibold text-muted">
              Self-registered
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "household",
      header: terms.identifierLabel,
      cell: (account) =>
        account.household?.identifier ??
        (account.isAppSupport
          ? "Not applicable (App Support)"
          : account.isAdmin || account.isReadonly
            ? "Not assigned"
            : "Assignment required before enabling"),
    },
    {
      key: "eligibility",
      header: "Voting eligibility",
      cell: (account) =>
        account.household ? (
          <EligibilityBadge eligible={account.household.isEligible} />
        ) : (
          "Not assigned"
        ),
    },
    {
      key: "role",
      header: "Role",
      cell: (account) => (
        <RoleBadge
          isAdmin={account.isAdmin}
          isReadonly={account.isReadonly}
          isAppSupport={account.isAppSupport}
        />
      ),
    },
    {
      key: "status",
      header: "Account status",
      cell: (account) => <AccountStatusBadge status={account.status} />,
    },
    {
      key: "updated",
      header: "Last changed",
      cell: (account) => formatInstant(account.updatedAt),
    },
    {
      key: "manage",
      header: "Actions",
      cell: (account) => (
        <Link
          href={`/admin/residents/${account.id}`}
          className="inline-flex touch-target items-center font-semibold text-accent underline"
        >
          Manage<span className="sr-only"> {account.representativeName}</span>
        </Link>
      ),
    },
  ];
  return (
    <div data-account-review className="grid gap-5">
      <div className="flex flex-wrap items-center gap-4 border-b border-border pb-5">
        <label className="inline-flex touch-target items-center gap-2">
          <input
            ref={selectPage}
            type="checkbox"
            className="size-5 accent-accent"
            checked={allSelected}
            disabled={busy || !selectable.length}
            onChange={(event) =>
              setSelected(
                event.target.checked
                  ? new Set(selectable.map((account) => account.id))
                  : new Set(),
              )
            }
          />
          Select All on This Page
        </label>
        <span role="status" className="font-semibold text-accent tabular-nums">
          {selected.size} selected{busy ? `; ${completed} completed` : ""}
        </span>
        <Button
          disabled={busy || !enable.length}
          onClick={() => setAction("enable")}
        >
          <UserCheck aria-hidden="true" className="size-5" />
          Enable Selected ({enable.length})
        </Button>
        <Button
          variant="secondary"
          disabled={busy || !eligible.length}
          onClick={() => setAction("eligible")}
        >
          <CheckCheck aria-hidden="true" className="size-5" />
          Make Eligible ({eligible.length})
        </Button>
      </div>
      {problem ? (
        <Notice tone="error" heading="Review before retrying">
          <p>{problem}</p>
        </Notice>
      ) : null}
      {outcomes.length ? (
        <Notice tone="success" heading={`${outcomes.length} completed`}>
          <ul className="list-disc pl-5">
            {outcomes.map((outcome, index) => (
              <li key={index}>{outcome}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <DataTable
        caption="Account access and voting eligibility review"
        columns={columns}
        rows={accounts}
        rowKey={(account) => account.id}
      />
      <ConfirmDialog
        open={action !== null}
        title={
          action === "enable"
            ? "Enable selected accounts?"
            : `Make selected ${terms.households} eligible?`
        }
        confirmLabel={action === "enable" ? "Enable Selected" : "Make Eligible"}
        busy={busy}
        onCancel={() => setAction(null)}
        onConfirm={() => void run()}
      >
        <p>
          {action === "enable"
            ? "This allows the listed accounts to sign in. It does not change voting eligibility or frozen electorates."
            : `This marks the listed ${terms.households} eligible for future votes. It does not enable accounts or add anyone to an existing scheduled or active vote.`}
        </p>
        {action === "enable" && targets.some((account) => account.isAdmin) ? (
          <Notice tone="warning" heading="Administrator access">
            <p>
              This selection includes administrators. Enabling them restores
              management access.
            </p>
          </Notice>
        ) : null}
        <ul className="max-h-60 overflow-y-auto">
          {targets.map((account) => (
            <li
              key={account.id}
              className="grid gap-1 border-b border-border py-2"
            >
              <span className="font-semibold">
                {account.representativeName}
              </span>
              <span className="text-caption break-all text-muted">
                {account.email ?? "Email unavailable"}
              </span>
              <span>
                {account.household?.identifier ?? "No assignment"}
                {account.isAdmin ? " - Administrator" : ""}
              </span>
            </li>
          ))}
        </ul>
        <p>
          {targets.length} changes, committed separately. A failure stops
          subsequent rows without undoing completed changes.
        </p>
      </ConfirmDialog>
    </div>
  );
}
