import Link from "next/link";

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
        href="/"
        className="inline-flex touch-target items-center font-semibold text-accent underline underline-offset-4"
      >
        Go to the home page
      </Link>
    </div>
  );
}
