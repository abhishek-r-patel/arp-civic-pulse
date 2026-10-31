// Resolves client IPs only from the explicitly configured Vercel ingress.
import "server-only";
import { isIP } from "node:net";
import { ApiError } from "@/server/http/errors";

type TrustedProxyEnvironment = Readonly<
  Partial<
    Pick<NodeJS.ProcessEnv, "NODE_ENV" | "TRUSTED_PROXY_CONFIG" | "VERCEL">
  >
>;

function unavailable(code: string): ApiError {
  return new ApiError("AUTH_UNAVAILABLE", {
    cause: { source: "trusted_proxy", code },
  });
}

export function trustedClientIp(
  request: Pick<Request, "headers">,
  environment: TrustedProxyEnvironment = process.env,
): string | undefined {
  const config = environment.TRUSTED_PROXY_CONFIG;
  if (!config) {
    if (environment.NODE_ENV !== "production") return undefined;
    throw unavailable("CONFIG_MISSING");
  }
  if (config !== "vercel") throw unavailable("CONFIG_UNSUPPORTED");
  if (environment.VERCEL !== "1") throw unavailable("VERCEL_RUNTIME_REQUIRED");

  const value = request.headers.get("x-forwarded-for")?.trim();
  if (!value) throw unavailable("CLIENT_IP_MISSING");
  const family = isIP(value);
  if (value.includes(",") || family === 0) {
    throw unavailable("CLIENT_IP_INVALID");
  }
  return family === 6
    ? new URL(`http://[${value}]/`).hostname.slice(1, -1)
    : value;
}
