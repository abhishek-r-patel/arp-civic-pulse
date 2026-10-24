import {
  Ban,
  CircleCheck,
  CircleDot,
  Eye,
  Lock,
  PencilLine,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  VOTE_STATUS_LABELS,
  VOTING_TYPE_LABELS,
  type VoteStatus,
  type VotingType,
} from "@/shared/contracts/voting";
import { cn } from "./cn";

const baseClasses =
  "inline-flex items-center gap-1.5 rounded-control border px-2 py-1 text-caption font-semibold";

const typeConfig: Record<VotingType, { icon: LucideIcon; classes: string }> = {
  OPEN: {
    icon: Eye,
    classes: "border-secondary/40 bg-secondary/10 text-secondary",
  },
  CLOSED: {
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
    ACTIVE: {
      icon: CircleDot,
      classes: "border-accent/40 bg-accent/10 text-accent",
    },
    COMPLETED: {
      icon: CircleCheck,
      classes: "border-success/40 bg-success/10 text-success",
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
