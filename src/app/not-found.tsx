// Accessible custom 404 without exposing whether a private record exists.
import Link from "next/link";
import { getRequestTenantContext } from "@/server/config/tenant-context";

export const metadata = {
  title: "Page not found",
  description:
    "The requested Civic Pulse page is unavailable. Return to sign-in or contact the administrator.",
  robots: { index: false, follow: false },
};

async function isMainHost(): Promise<boolean> {
  try {
    return (await getRequestTenantContext()).kind === "main";
  } catch {
    return false;
  }
}

export default async function NotFound() {
  // The product website has no sign-in, so it links back to its own pages.
  const main = await isMainHost();
  return (
    <div className="grid max-w-ballot gap-4">
      <h1 className="text-page-title font-semibold md:text-page-title-lg">
        Page not found
      </h1>
      <p className="text-body text-muted">
        {main
          ? "This page does not exist. Residents sign in on their own association's Civic Pulse site, not on this website."
          : "This page does not exist or you do not have access to it."}
      </p>
      <Link
        href={main ? "/" : "/sign-in"}
        className="inline-flex touch-target items-center font-semibold text-accent underline underline-offset-4"
      >
        {main ? "Go to the Civic Pulse home page" : "Go to sign in"}
      </Link>
      <Link
        href="/contact"
        className="inline-flex touch-target items-center text-accent underline underline-offset-4"
      >
        {main ? "Contact sales" : "Contact the administrator"}
      </Link>
    </div>
  );
}
