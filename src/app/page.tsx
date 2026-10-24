import { Notice } from "@/components/ui/notice";

export default function HomePage() {
  return (
    <div className="grid max-w-ballot gap-4">
      <h1 className="text-page-title font-semibold md:text-page-title-lg">
        Civic Pulse
      </h1>
      <p className="text-body text-muted">
        Voting and polls for one Resident Welfare Association.
      </p>
      <Notice tone="info" heading="Project foundation is ready">
        Sign-in, voting and administration have not been built yet.
      </Notice>
    </div>
  );
}
