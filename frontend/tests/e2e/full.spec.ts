import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Full suite — runs on pushes to main and nightly. Every original OOP
// feature plus every zero-to-hero addition, asserted through the real UI.
test.describe("courier management", () => {
  test("empty booking is rejected inline, nothing is created", async ({ page, request }) => {
    const before = (await (await request.get("/api/stats")).json()).total;
    await page.goto("/");
    await page.getByRole("button", { name: "Add courier" }).click();
    await page.getByRole("button", { name: "Book courier" }).click();
    await expect(page.getByText("Enter the customer name.")).toBeVisible();
    await expect(page.getByText("Enter a valid phone number.")).toBeVisible();
    await expect(page.getByText("Enter the origin city.")).toBeVisible();
    await expect(page.getByText("Enter the destination city.")).toBeVisible();
    const after = (await (await request.get("/api/stats")).json()).total;
    expect(after).toBe(before);
  });

  test("illegal status jump is rejected and state is unchanged", async ({ page, request }) => {
    const name = `Jump Guard ${Date.now()}`;
    const created = await request.post("/api/couriers", {
      data: { customer_name: name, phone: "+15550007777", parcel_type: "Documents", weight_kg: 1, source: "Reno", destination: "Fresno" },
    });
    expect(created.ok()).toBeTruthy();
    const { id } = await created.json();
    try {
      await page.goto("/");
      await page.getByRole("button", { name: "Track & status" }).click();
      await page.getByRole("textbox", { name: "Tracking lookup" }).fill(String(id));
      await page.getByRole("textbox", { name: "Tracking lookup" }).press("Enter");
      await expect(page.getByText("Label created")).toBeVisible();
      page.once("dialog", (d) => {
        expect(d.message()).toContain("Illegal transition");
        d.accept();
      });
      await page.getByRole("main").getByRole("button", { name: "Delivered", exact: true }).click();
      await expect(page.getByText("Current:")).toBeVisible();
      const check = await request.get(`/api/couriers/${id}`);
      expect((await check.json()).status).toBe("booked");
    } finally {
      await request.delete(`/api/couriers/${id}`);
    }
  });

  test("smart top search routes codes to tracking, words to filter", async ({ page, request }) => {
    const name = `Smart Search ${Date.now()}`;
    const created = await request.post("/api/couriers", {
      data: { customer_name: name, phone: "+15550007666", parcel_type: "Books", weight_kg: 1, source: "Yuma", destination: "Tucson" },
    });
    const { id, tracking_id } = await created.json();
    try {
      await page.goto("/");
      const search = page.getByRole("textbox", { name: "Track or search couriers" });
      await search.fill(tracking_id);
      await search.press("Enter");
      await expect(page.getByRole("heading", { name: new RegExp(tracking_id) })).toBeVisible();

      await search.fill(name.split(" ")[0]);
      await search.press("Enter");
      await expect(page.getByText("1 shown")).toBeVisible();
      await expect(page.getByText(name)).toBeVisible();
    } finally {
      await request.delete(`/api/couriers/${id}`);
    }
  });

  test("pricing calculator matches the server formula", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Pricing" }).click();
    await page.getByRole("textbox", { name: "Weight in kg" }).fill("10");
    await page.getByRole("button", { name: "Calculate" }).click();
    await expect(page.getByText("$51.99 (base $6.99 + 10 kg × $4.50)")).toBeVisible();
  });

  test("delivered view lists only delivered shipments", async ({ page, request }) => {
    const stats = await (await request.get("/api/stats")).json();
    await page.goto("/");
    await page.getByRole("button", { name: "Delivered" }).click();
    await expect(page.getByText(`${stats.delivered} shown`)).toBeVisible();
    const pills = await page.locator(".pill.st-delivered").count();
    expect(pills).toBeGreaterThanOrEqual(stats.delivered);
  });

  test("revenue report shows gross and 14-day chart", async ({ page, request }) => {
    const rev = await (await request.get("/api/revenue")).json();
    await page.goto("/");
    await page.getByRole("button", { name: "Revenue" }).click();
    await expect(page.getByText(`$${rev.total_revenue_usd.toFixed(2)}`)).toBeVisible();
    await expect(page.getByRole("img", { name: /Revenue by day/ })).toBeVisible();
    await expect(page.getByText(/SWC-[0-9A-F]{6}/).first()).toBeVisible();
  });

  test("copy tracking link confirms", async ({ page, request }) => {
    const created = await request.post("/api/couriers", {
      data: { customer_name: "Link Copy", phone: "+15550007555", parcel_type: "Books", weight_kg: 1, source: "Yuma", destination: "Tucson" },
    });
    const { id } = await created.json();
    try {
      await page.goto(`/?track=${id}`);
      await expect(page.getByRole("heading", { name: /SWC-/ })).toBeVisible();
      await page.getByRole("button", { name: "Copy tracking link" }).click();
      await expect(page.getByRole("button", { name: "Link copied ✓" })).toBeVisible();
    } finally {
      await request.delete(`/api/couriers/${id}`);
    }
  });

  test("theme toggle switches to light and persists", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator('html[data-theme="light"]')).toBeAttached();
    await page.reload();
    await expect(page.locator('html[data-theme="light"]')).toBeAttached();
    // Restore dark-first default for the next run.
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator('html[data-theme="dark"]')).toBeAttached();
  });

  test("no serious accessibility violations on dashboard and tracking", async ({ page, request }) => {
    const baseline = (await (await request.get("/api/revenue")).json()).total_revenue_usd as number;
    const created = await request.post("/api/couriers", {
      data: { customer_name: "Axe Probe", phone: "+15550007444", parcel_type: "Books", weight_kg: 1, source: "Yuma", destination: "Tucson" },
    });
    const { id } = await created.json();
    const expectedGross = `$${(baseline + 11.49).toFixed(2)}`; // 1 kg → $6.99 + $4.50
    try {
      await page.goto("/");
      await expect(page.getByText(expectedGross)).toBeVisible();
      const dash = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(dash.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

      await page.goto(`/?track=${id}`);
      await expect(page.getByRole("heading", { name: /SWC-/ })).toBeVisible();
      const track = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(track.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    } finally {
      await request.delete(`/api/couriers/${id}`);
    }
  });
});
