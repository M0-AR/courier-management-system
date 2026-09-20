import { describe, expect, it, vi, beforeEach } from "vitest";
import { api, money, NEXT_STATUS, STATUS_LABEL, type Status } from "./api";

// Contract: every status the backend can return must have a label and a
// defined forward transition (null = terminal). If the backend adds a
// status, this test fails until the UI handles it — by design.
const ALL_STATUSES: Status[] = ["booked", "in_transit", "out_for_delivery", "delivered", "cancelled"];

describe("status machine mirror", () => {
  it("labels every known status", () => {
    for (const s of ALL_STATUSES) expect(STATUS_LABEL[s]).toBeTruthy();
  });

  it("advances forward-only and terminates", () => {
    expect(NEXT_STATUS.booked).toBe("in_transit");
    expect(NEXT_STATUS.in_transit).toBe("out_for_delivery");
    expect(NEXT_STATUS.out_for_delivery).toBe("delivered");
    expect(NEXT_STATUS.delivered).toBeNull();
    expect(NEXT_STATUS.cancelled).toBeNull();
  });
});

describe("money", () => {
  it("formats USD with cents", () => {
    expect(money(15.99)).toBe("$15.99");
    expect(money(150.99)).toBe("$150.99");
  });

  it("tolerates missing values", () => {
    expect(money(null as unknown as number)).toBe("$0.00");
  });
});

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/by-tracking/")) {
          return { ok: true, status: 200, json: async () => ({ id: 1 }) };
        }
        return { ok: false, status: 404, statusText: "Not Found", json: async () => ({ detail: "Nope" }) };
      })
    );
  });

  it("builds the tracking-code URL (no list+q hack)", async () => {
    const c = await api.byTracking("swc-abc123");
    expect((c as unknown as { id: number }).id).toBe(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/couriers/by-tracking/swc-abc123");
  });

  it("surfaces server detail messages on errors", async () => {
    await expect(api.get(999)).rejects.toThrow("Nope");
  });

  it("encodes list filters", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] } as Response);
    await api.list({ status: "delivered", q: "a b" });
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain("status=delivered");
    expect(url).toContain("q=a+b");
    expect(url).toContain("limit=200");
  });
});
