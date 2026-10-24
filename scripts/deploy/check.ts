import { parseEnvironment } from "../../src/server/config/environment.ts";

try {
  parseEnvironment({ ...process.env, NODE_ENV: "production" });
  console.log(
    "Production environment shape validated; no credential values were printed.",
  );
  console.warn(
    "Release gates remain manual: trusted-ingress/IP enforcement, production-project isolation, provider/region approval, SMTP, migrations, policy approvals and recovery evidence. TRUSTED_PROXY_CONFIG does not enable IP enforcement.",
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Production environment validation failed.",
  );
  process.exitCode = 1;
}
