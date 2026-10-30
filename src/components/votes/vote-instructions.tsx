// Collapsed PUBLIC Background / PRIVATE voter instructions shown under vote page headers.
import { ChevronDown } from "lucide-react";

export function VoteInstructions({
  instructions,
  votingType,
}: Readonly<{
  instructions: string | null | undefined;
  votingType: "PUBLIC" | "PRIVATE";
}>) {
  const text = instructions?.trim();
  if (!text) return null;
  return (
    // Pulls up under the PageHeader rule so it reads as part of the header.
    <details className="group -mt-4">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden="true"
          className="size-5 transition-transform group-open:rotate-180"
        />
        {votingType === "PUBLIC" ? "Background" : "Instructions for voters"}
      </summary>
      <p className="mt-2 max-w-ballot text-body whitespace-pre-line text-muted">
        {text}
      </p>
    </details>
  );
}
