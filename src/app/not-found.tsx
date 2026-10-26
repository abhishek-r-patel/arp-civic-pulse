// Accessible custom 404 without exposing whether a private record exists.
import Link from "next/link";

export const metadata = {
  title: "Page not found",
  description:
    "The requested Civic Pulse page is unavailable. Return to sign-in or contact the administrator.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="grid max-w-ballot gap-4">
      <h1 className="text-page-title font-semibold md:text-page-title-lg">
        Page not found
      </h1>
      <p className="text-body text-muted">
        This page does not exist or you do not have access to it.
      </p>
      <Link
        href="/sign-in"
        className="inline-flex touch-target items-center font-semibold text-accent underline underline-offset-4"
      >
        Go to sign in
      </Link>
      <Link
        href="/contact"
        className="inline-flex touch-target items-center text-accent underline underline-offset-4"
      >
        Contact the administrator
      </Link>
    </div>
  );
}
