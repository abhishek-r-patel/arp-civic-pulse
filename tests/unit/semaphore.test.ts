import { describe, expect, it } from "vitest";
import { Semaphore } from "@/server/exports/semaphore";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Semaphore", () => {
  it("never runs more than its limit at once, and serves waiters in order", async () => {
    const gate = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const release = await gate.acquire(5_000);
        order.push(i);
        active += 1;
        peak = Math.max(peak, active);
        await sleep(20);
        active -= 1;
        release();
      }),
    );
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("gives up after the maximum wait, without leaking a slot", async () => {
    const gate = new Semaphore(1);
    const release = await gate.acquire(1_000);
    await expect(gate.acquire(30)).rejects.toThrow(/exceeded/u);
    release();
    // The timed-out waiter did not take the slot with it.
    const again = await gate.acquire(1_000);
    again();
  });
});
