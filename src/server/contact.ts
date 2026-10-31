// Server-only support delivery through Resend; provider details and message bodies are never logged.
import "server-only";
import { z } from "zod";
import { getEnvironment } from "@/server/config/environment";
import { ApiError } from "@/server/http/errors";
import type { ContactMessage } from "@/shared/contracts/contact";

export function contactEnabled(): boolean {
  const environment = getEnvironment();
  return Boolean(
    environment.RESEND_API_KEY &&
    environment.CONTACT_EMAIL_FROM &&
    environment.CONTACT_EMAIL_TO,
  );
}

export async function sendContact(
  message: ContactMessage,
  requestId: string,
  // Every RWA host shares one operator inbox, so the subject names the site.
  siteHost?: string,
): Promise<void> {
  const environment = getEnvironment();
  if (!contactEnabled()) throw contactDisabled();
  // Only the provider's HTTP status and a fixed stage label are recorded.
  let providerStatus: number | undefined;
  let failureCode = "NETWORK_OR_TIMEOUT";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${environment.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `contact-${requestId}`,
      },
      body: JSON.stringify({
        from: environment.CONTACT_EMAIL_FROM,
        to: [environment.CONTACT_EMAIL_TO],
        reply_to: message.email,
        subject: siteHost
          ? `Civic Pulse contact enquiry (${siteHost})`
          : "Civic Pulse contact enquiry",
        text: `Name: ${message.name}\nReply email: ${message.email}\n\n${message.message}`,
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    providerStatus = response.status;
    if (!response.ok) {
      failureCode = "PROVIDER_REJECTED";
      throw new Error("Delivery rejected");
    }
    failureCode = "NOT_ACKNOWLEDGED";
    if (
      !z.object({ id: z.string().min(1) }).safeParse(await response.json())
        .success
    ) {
      throw new Error("Delivery not acknowledged");
    }
  } catch {
    throw new ApiError("DEPENDENCY_UNAVAILABLE", {
      message:
        "We could not confirm that your message was sent. Wait before retrying, or contact your RWA administrator directly.",
      cause: {
        source: "email_provider",
        code: failureCode,
        status: providerStatus,
      },
    });
  }
}

// Contact email is optional per deployment; being off is configuration, not a fault.
export function contactDisabled(): ApiError {
  return new ApiError("DEPENDENCY_UNAVAILABLE", {
    cause: { source: "deployment_config", code: "CONTACT_EMAIL_DISABLED" },
    report: false,
  });
}
