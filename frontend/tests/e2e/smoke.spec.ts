import { expect, test } from "@playwright/test";

// @smoke — the critical path. PRs run only this file (fast feedback);
// pushes to main run the whole suite.
test.describe("smoke: critical path", () => {
  test("dashboard shows live KPIs and activity", { tag: "@smoke" }, async ({ page, request }) => {
    const stats = await (await request.get("/api/stats")).json();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
    await expect(page.getByText(/Total shipments/)).toBeVisible();
    // KPIs mirror the API — true on seeded demo data or any live dataset.
    await expect(page.getByText(String(stats.total), { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`$${stats.total_revenue_usd.toFixed(2)}`)).toBeVisible();
    await expect(page.getByRole("list").first()).toBeVisible();
  });

  test("booking flow creates a priced, trackable courier", { tag: "@smoke" }, async ({ page }) => {
    const name = `Smoke Buyer ${Date.now()}`;
    await page.goto("/");
    await page.getByRole("button", { name: "Add courier" }).click();
    await page.getByRole("textbox", { name: "Customer name" }).fill(name);
    await page.getByRole("textbox", { name: "Phone" }).fill("+15550009999");
    await page.getByRole("textbox", { name: "Source" }).fill("Tulsa");
    await page.getByRole("textbox", { name: "Destination" }).fill("Omaha");
    await page.getByRole("button", { name: "Book courier" }).click();
    // Lands on the tracking page with server-computed charge + ETA.
    await expect(page.getByRole("heading", { name: /SWC-/ })).toBeVisible();
    await expect(page.getByText("$15.99")).toBeVisible();
    await expect(page.getByText(/Estimated 20\d\d-\d\d-\d\d/)).toBeVisible();
    // Self-cleaning: delete via the table so the demo dataset stays pristine.
    await page.getByRole("button", { name: "All couriers" }).click();
    await page.getByRole("textbox", { name: "Track or search couriers" }).fill(name);
    await page.getByRole("textbox", { name: "Track or search couriers" }).press("Enter");
    await expect(page.getByText("1 shown")).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("0 shown")).toBeVisible();
  });

  test("tracking page advances status and logs scan history", { tag: "@smoke" }, async ({ page, request }) => {
    const name = `Smoke Adv ${Date.now()}`;
    await page.goto("/");
    await page.getByRole("button", { name: "Add courier" }).click();
    await page.getByRole("textbox", { name: "Customer name" }).fill(name);
    await page.getByRole("textbox", { name: "Phone" }).fill("+15550009998");
    await page.getByRole("textbox", { name: "Source" }).fill("Reno");
    await page.getByRole("textbox", { name: "Destination" }).fill("Fresno");
    await page.getByRole("button", { name: "Book courier" }).click();
    await page.getByRole("button", { name: "Advance → In transit" }).click();
    await expect(page.getByText("Current:")).toBeVisible();
    await expect(page.getByText("Booked → In transit")).toBeVisible();
    // Self-cleaning via API (the UI delete path is covered in the booking test).
    const heading = (await page.getByRole("heading", { name: /SWC-/ }).textContent()) ?? "";
    const id = heading.match(/#(\d+)/)?.[1];
    expect(id).toBeTruthy();
    const del = await request.delete(`/api/couriers/${id}`);
    expect(del.ok()).toBeTruthy();
  });
});
