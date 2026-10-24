import { readFileSync } from "node:fs";
import { Client, type ClientConfig } from "pg";

const TLS_PARAMETERS = new Set(["sslmode", "sslrootcert", "sslcert", "sslkey"]);

function connection(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
    decodeURIComponent(parsed.username);
    decodeURIComponent(parsed.password);
    decodeURIComponent(parsed.pathname);
  } catch {
    throw new Error("Invalid operational database URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    !parsed.username ||
    parsed.pathname.length <= 1 ||
    parsed.hash
  ) {
    throw new Error("Invalid operational database URL.");
  }
  const seen = new Set<string>();
  for (const [name] of parsed.searchParams) {
    if (!TLS_PARAMETERS.has(name) || seen.has(name)) {
      throw new Error(
        "Unsupported or repeated operational database URL parameter.",
      );
    }
    seen.add(name);
  }
  const host = parsed.hostname.replace(/^\[|\]$/gu, "");
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(host);
  const mode =
    parsed.searchParams.get("sslmode") ??
    (loopback ? "disable" : "verify-full");
  if (mode !== "verify-full" && !(loopback && mode === "disable")) {
    throw new Error(
      "Remote operational database connections require sslmode=verify-full.",
    );
  }
  return {
    host,
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)),
    mode,
    root:
      parsed.searchParams.get("sslrootcert") ||
      process.env.PGSSLROOTCERT ||
      "system",
    cert: parsed.searchParams.get("sslcert") || process.env.PGSSLCERT,
    key: parsed.searchParams.get("sslkey") || process.env.PGSSLKEY,
  };
}

// Construct fields explicitly: URL query parameters must not override host or TLS policy.
export function operationalDatabaseConfig(url: string): ClientConfig {
  const config = connection(url);
  return {
    host: config.host,
    port: Number(config.port),
    user: config.user,
    password: config.password,
    database: config.database,
    ssl:
      config.mode === "disable"
        ? false
        : {
            rejectUnauthorized: true,
            ...(config.root !== "system" && {
              ca: readFileSync(config.root, "utf8"),
            }),
            ...(config.cert && { cert: readFileSync(config.cert, "utf8") }),
            ...(config.key && { key: readFileSync(config.key, "utf8") }),
          },
  };
}

export function operationalDatabaseClient(url: string): Client {
  return new Client(operationalDatabaseConfig(url));
}

export function pgEnv(
  url: string,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const config = connection(url);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extra,
    PGHOST: config.host,
    PGPORT: config.port,
    PGUSER: config.user,
    PGDATABASE: config.database,
    PGPASSWORD: config.password,
    PGSSLMODE: config.mode,
  };
  // A service file or a separate host address could redirect an ostensibly loopback connection.
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  delete env.PGHOSTADDR;
  if (config.mode === "verify-full") {
    env.PGSSLROOTCERT = config.root;
  } else {
    delete env.PGSSLROOTCERT;
  }
  if (config.cert) env.PGSSLCERT = config.cert;
  if (config.key) env.PGSSLKEY = config.key;
  return env;
}
