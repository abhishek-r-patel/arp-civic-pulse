import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

type NoticeTone = "info" | "success" | "warning" | "error";

type NoticeProps = Readonly<{
  tone?: NoticeTone;
  heading?: string;
  children: ReactNode;
  className?: string;
}>;

const toneConfig: Record<
  NoticeTone,
  { icon: LucideIcon; classes: string; role?: "status" | "alert" }
> = {
  info: {
    icon: Info,
    classes: "border-accent/40 bg-accent/10 text-accent",
  },
  success: {
    icon: CircleCheck,
    classes: "border-success/40 bg-success/10 text-success",
    role: "status",
  },
  warning: {
    icon: TriangleAlert,
    classes: "border-warning/40 bg-warning/10 text-warning",
  },
  error: {
    icon: CircleAlert,
    classes: "border-error/40 bg-error/10 text-error",
    role: "alert",
  },
};

// Colour is never the only signal: every tone has an icon and visible text.
export function Notice({
  tone = "info",
  heading,
  children,
  className,
}: NoticeProps) {
  const { icon: Icon, classes, role } = toneConfig[tone];

  return (
    <div
      role={role}
      className={cn(
        "flex w-full gap-3 rounded-card border p-4",
        classes,
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        {heading ? (
          <p className="text-card-heading font-semibold">{heading}</p>
        ) : null}
        <div className="text-body text-primary">{children}</div>
      </div>
    </div>
  );
}
