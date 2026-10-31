// Persistent notice on every demo page: fictional data, changes turned off.
import { activeSiteOrigin } from "@/server/config/tenant-context";

export function DemoBanner() {
  const mainOrigin = activeSiteOrigin("main");
  return (
    <div
      role="note"
      aria-label="Demo notice"
      className="border-b border-warning/40 bg-warning/5 px-4 py-2 text-caption text-warning md:px-6"
    >
      <p className="mx-auto max-w-content">
        <strong>Demo:</strong> every name, home and vote here is fictional, and
        changes are turned off. Sign in as a sample resident or committee member
        to look around.
        {mainOrigin ? (
          <>
            {" "}
            <a href={mainOrigin} className="underline">
              About Civic Pulse
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}
