import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/internal/health/route";

const { rpc, abortSignal } = vi.hoisted(() => ({
  rpc: vi.fn(),
  abortSignal: vi.fn(),
}));
vi.mock("@/server/db/clients", () => ({
  createAdminClient: () => ({ rpc }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("MAINTENANCE_MODE", "0");
  rpc.mockReset().mockReturnValue({ abortSignal });
  abortSignal.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const call = () => GET(new Request("http://localhost/api/internal/health"));

describe("bounded health probe", () => {
  it("reports a healthy database and clears the timeout on success", async () => {
    abortSignal.mockResolvedValue({ data: true, error: null });
    const response = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ status: "ok" });
    expect(rpc).toHaveBeenCalledWith("health_ping");
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("actually aborts the pending provider request at three seconds", async () => {
    let signal: AbortSignal | undefined;
    abortSignal.mockImplementation((value: AbortSignal) => {
      signal = value;
      return new Promise((resolve) => {
        value.addEventListener(
          "abort",
          () => resolve({ data: null, error: { message: "aborted" } }),
          { once: true },
        );
      });
    });
    const pending = call();
    await vi.advanceTimersByTimeAsync(2999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(signal?.aborted).toBe(true);
    expect(response.status).toBe(503);
    expect((await response.json()).data).toEqual({ status: "unavailable" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears timers and withholds provider details when the probe fails", async () => {
    abortSignal.mockRejectedValue(new Error("sensitive provider diagnostic"));
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(
      "sensitive provider diagnostic",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does no database work during maintenance", async () => {
    vi.stubEnv("MAINTENANCE_MODE", "1");
    expect((await call()).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
