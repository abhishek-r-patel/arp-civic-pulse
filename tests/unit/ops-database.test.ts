import { afterEach, describe, expect, it, vi } from "vitest";
import {
  operationalDatabaseConfig,
  pgEnv,
} from "../../scripts/ops/database.ts";

afterEach(() => vi.unstubAllEnvs());

describe("operational database transport", () => {
  const remote =
    "postgresql://backup:synthetic-password@database.example.test:5432/civic";

  it("requires certificate and hostname verification by default in both clients", () => {
    vi.stubEnv("PGSSLROOTCERT", "system");
    expect(operationalDatabaseConfig(remote)).toMatchObject({
      host: "database.example.test",
      database: "civic",
      port: 5432,
      ssl: { rejectUnauthorized: true },
    });
    expect(pgEnv(remote)).toMatchObject({
      PGHOST: "database.example.test",
      PGSSLMODE: "verify-full",
      PGSSLROOTCERT: "system",
    });
  });

  it.each([
    "disable",
    "allow",
    "prefer",
    "require",
    "verify-ca",
    "no-verify",
    "",
  ])(
    "rejects a remote TLS downgrade (%s) before connecting or starting a dump",
    (mode) => {
      for (const configure of [operationalDatabaseConfig, pgEnv]) {
        expect(() => configure(`${remote}?sslmode=${mode}`)).toThrow(
          /verify-full/u,
        );
      }
    },
  );

  it("does not inherit a TLS downgrade or service-file/host-address redirect", () => {
    vi.stubEnv("PGSSLMODE", "disable");
    vi.stubEnv("PGSERVICE", "unsafe");
    vi.stubEnv("PGSERVICEFILE", "unsafe.conf");
    vi.stubEnv("PGHOSTADDR", "203.0.113.1");
    const env = pgEnv(remote, {
      PGSSLMODE: "disable",
      PGOPTIONS: "-c session_replication_role=replica",
    });
    expect(env.PGSSLMODE).toBe("verify-full");
    expect(env.PGOPTIONS).toBe("-c session_replication_role=replica");
    for (const key of ["PGSERVICE", "PGSERVICEFILE", "PGHOSTADDR"]) {
      expect(env[key]).toBeUndefined();
    }
    expect(operationalDatabaseConfig(remote).ssl).toMatchObject({
      rejectUnauthorized: true,
    });
  });

  it.each([
    "host=127.0.0.1",
    "ssl=false",
    "uselibpqcompat=true",
    "sslmode=disable&sslmode=verify-full",
  ])(
    "rejects query parameters that could override the transport policy: %s",
    (query) => {
      for (const configure of [operationalDatabaseConfig, pgEnv]) {
        expect(() => configure(`${remote}?${query}`)).toThrow(/parameter/u);
      }
    },
  );

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "preserves non-TLS local development for literal loopback %s",
    (host) => {
      const local = `postgres://operator@${host}:54399/local`;
      expect(operationalDatabaseConfig(local).ssl).toBe(false);
      expect(pgEnv(local).PGSSLMODE).toBe("disable");
      expect(pgEnv(local).PGSSLROOTCERT).toBeUndefined();
    },
  );

  it("never treats a loopback-looking remote hostname as local", () => {
    expect(
      operationalDatabaseConfig("postgres://operator@localhost.example.test/db")
        .ssl,
    ).toMatchObject({ rejectUnauthorized: true });
    expect(() =>
      pgEnv("postgres://operator@127.0.0.1.example.test/db?sslmode=disable"),
    ).toThrow(/verify-full/u);
  });

  it("decodes credentials once and keeps them off native tool command lines", () => {
    const url = "postgres://backup:p%40ss%3Aword@127.0.0.1/civic";
    expect(operationalDatabaseConfig(url).password).toBe("p@ss:word");
    expect(pgEnv(url).PGPASSWORD).toBe("p@ss:word");
  });

  it.each([
    "not a URL synthetic-password",
    "https://backup:synthetic-password@example.test/db",
    "postgres://backup:%xx@example.test/db",
  ])(
    "rejects invalid connection configuration without echoing credentials",
    (url) => {
      for (const configure of [operationalDatabaseConfig, pgEnv]) {
        let message = "";
        try {
          configure(url);
        } catch (error) {
          message = error instanceof Error ? error.message : "";
        }
        expect(message).toContain("Invalid operational database URL");
        expect(message).not.toContain("synthetic-password");
        expect(message).not.toContain("%xx");
      }
    },
  );
});
