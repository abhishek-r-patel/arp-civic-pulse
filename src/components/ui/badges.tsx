// Shared accessible role, eligibility, voting type and lifecycle badges.
import {
  Ban,
  Circle,
  CircleCheck,
  CircleDot,
  CircleOff,
  CirclePause,
  Clock,
  Eye,
  Lock,
  PencilLine,
  Shield,
  ShieldCheck,
  User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  ACCOUNT_STATUS_LABELS,
  type AccountStatus,
} from "@/shared/contracts/register";
import {
  VOTE_STATUS_LABELS,
  VOTING_TYPE_LABELS,
  type VoteStatus,
  type VotingType,
} from "@/shared/contracts/voting";
import { cn } from "./cn";

const baseClasses =
  "inline-flex max-w-full items-center gap-1.5 rounded-control border px-2 py-1 text-caption font-semibold";

const typeConfig: Record<VotingType, { icon: LucideIcon; classes: string }> = {
  PUBLIC: {
    icon: Eye,
    classes: "border-secondary/40 bg-secondary/10 text-secondary",
  },
  PRIVATE: {
    icon: Lock,
    classes: "border-primary/40 bg-primary/10 text-primary",
  },
};

const statusConfig: Record<VoteStatus, { icon: LucideIcon; classes: string }> =
  {
    DRAFT: {
      icon: PencilLine,
      classes: "border-muted/40 bg-muted/10 text-muted",
    },
    SCHEDULED: {
      icon: Clock,
      classes: "border-secondary/40 bg-secondary/10 text-secondary",
    },
    ACTIVE: {
      icon: CircleDot,
      classes: "border-accent/40 bg-accent/10 text-accent",
    },
    COMPLETED: {
      icon: CircleCheck,
      classes: "border-success/40 bg-success/5 text-success",
    },
    CANCELLED: {
      icon: Ban,
      classes: "border-error/40 bg-error/10 text-error",
    },
  };

export function VotingTypeBadge({ type }: Readonly<{ type: VotingType }>) {
  const { icon: Icon, classes } = typeConfig[type];

  return (
    <span className={cn(baseClasses, classes)}>
      <Icon aria-hidden="true" className="size-4" />
      {VOTING_TYPE_LABELS[type]}
    </span>
  );
}

export function VoteStatusBadge({ status }: Readonly<{ status: VoteStatus }>) {
  const { icon: Icon, classes } = statusConfig[status];

  return (
    <span className={cn(baseClasses, classes)}>
      <Icon aria-hidden="true" className="size-4" />
      {VOTE_STATUS_LABELS[status]}
    </span>
  );
}

// Personal participation is a third, separate concept from type and status.
export function ParticipationBadge({
  submitted,
}: Readonly<{ submitted: boolean }>) {
  return (
    <span
      className={cn(
        baseClasses,
        submitted
          ? "border-success/40 bg-success/5 text-success"
          : "border-muted/40 bg-muted/10 text-muted",
      )}
    >
      {submitted ? (
        <CircleCheck aria-hidden="true" className="size-4" />
      ) : (
        <Circle aria-hidden="true" className="size-4" />
      )}
      {submitted ? "Submitted" : "Not voted"}
    </span>
  );
}

const accountStatusConfig: Record<
  AccountStatus,
  { icon: LucideIcon; classes: string }
> = {
  ENABLED: {
    icon: CircleCheck,
    classes: "border-success/40 bg-success/5 text-success",
  },
  SUSPENDED: {
    icon: CirclePause,
    classes: "border-warning/40 bg-warning/5 text-warning",
  },
  DELETED: {
    icon: Ban,
    classes: "border-error/40 bg-error/10 text-error",
  },
};

export function AccountStatusBadge({
  status,
  iconOnly = false,
}: Readonly<{ status: AccountStatus; iconOnly?: boolean }>) {
  const { icon: Icon, classes } = accountStatusConfig[status];

  if (iconOnly) {
    return (
      <details className="relative inline-block">
        <summary
          title={ACCOUNT_STATUS_LABELS[status]}
          className={cn(
            baseClasses,
            classes,
            "size-12 cursor-pointer list-none justify-center [&::-webkit-details-marker]:hidden",
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
          <span className="sr-only">{ACCOUNT_STATUS_LABELS[status]}</span>
        </summary>
        <span className="absolute top-full left-0 z-20 mt-1 w-max rounded-control border border-border bg-surface px-3 py-2 text-caption text-primary shadow-panel">
          {ACCOUNT_STATUS_LABELS[status]}
        </span>
      </details>
    );
  }

  return (
    <span className={cn(baseClasses, classes)}>
      <Icon aria-hidden="true" className="size-4" />
      {ACCOUNT_STATUS_LABELS[status]}
    </span>
  );
}

export function RegistrationSourceBadge({
  selfRegistered,
}: Readonly<{ selfRegistered: boolean }>) {
  const label = selfRegistered ? "Self-registered" : "Admin-registered";
  const Icon = selfRegistered ? User : Shield;
  return (
    <details className="relative inline-block">
      <summary
        title={label}
        className={cn(
          baseClasses,
          "size-12 cursor-pointer list-none justify-center border-muted/40 bg-muted/10 text-primary [&::-webkit-details-marker]:hidden",
        )}
      >
        <Icon aria-hidden="true" className="size-4" />
        <span className="sr-only">{label}</span>
      </summary>
      <span className="absolute top-full left-0 z-20 mt-1 w-max rounded-control border border-border bg-surface px-3 py-2 text-caption text-primary shadow-panel">
        {label}
      </span>
    </details>
  );
}

export function RoleBadge({
  isAdmin,
  isReadonly,
  isAppSupport,
}: Readonly<{
  isAdmin: boolean;
  isReadonly?: boolean;
  isAppSupport?: boolean;
}>) {
  const Icon = isAdmin || isReadonly ? ShieldCheck : User;

  return (
    <span
      className={cn(
        baseClasses,
        isAdmin
          ? "border-error/40 bg-error/10 text-error"
          : isReadonly || isAppSupport
            ? "border-warning/40 bg-warning/5 text-warning"
            : "border-success/40 bg-success/5 text-success",
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
      {isAdmin
        ? "RWA Admin"
        : isAppSupport
          ? "App Support (ReadOnly)"
          : isReadonly
            ? "RWA ReadOnly"
            : "Voter"}
    </span>
  );
}

export function EligibilityBadge({
  eligible,
}: Readonly<{ eligible: boolean }>) {
  return (
    <span
      className={cn(
        baseClasses,
        eligible
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-muted/40 bg-muted/10 text-muted",
      )}
    >
      {eligible ? (
        <CircleCheck aria-hidden="true" className="size-4" />
      ) : (
        <CircleOff aria-hidden="true" className="size-4" />
      )}
      {eligible ? "Eligible" : "Not eligible"}
    </span>
  );
}
