import { Notice } from "@/components/ui/notice";
import type { VotingType } from "@/shared/contracts/voting";

/*
 * Approved privacy and finality copy (docs/DESIGN_SYSTEM.md section 09). It
 * lives in one place so the administrator preview and the resident ballot can
 * never drift apart. Never promise secrecy from privileged infrastructure
 * access, and never hide the limits behind hover.
 */
export const PRIVACY_COPY = {
  OPEN: "After voting ends, eligible members and RWA admins can see your name, flat and choice, including in downloadable results.",
  CLOSED:
    "Your selections are not shown to residents or RWA admins. Results show totals only.",
  CLOSED_LIMITS:
    "This protects choices within the app, not against privileged infrastructure access. Results from very small elections may allow people to infer choices.",
  FINAL: "Your submission is final. You cannot change or withdraw it.",
} as const;

export function PrivacyNotice({ type }: Readonly<{ type: VotingType }>) {
  if (type === "OPEN") {
    return (
      <Notice tone="warning" heading="Your choice is not private">
        <p>{PRIVACY_COPY.OPEN}</p>
      </Notice>
    );
  }
  return (
    <Notice tone="warning" heading="Your selections are private">
      <p>{PRIVACY_COPY.CLOSED}</p>
      <p className="pt-2">{PRIVACY_COPY.CLOSED_LIMITS}</p>
    </Notice>
  );
}

export function FinalSubmissionNotice() {
  return (
    <Notice tone="info" heading="Final submission">
      <p>{PRIVACY_COPY.FINAL}</p>
    </Notice>
  );
}
