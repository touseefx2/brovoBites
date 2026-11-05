/**
 * Admin Orders "All time": only the newest 300 orders load at first, with a
 * note and "Load older orders"; loading more shows the full history (nothing
 * newer dropped by the page cut). Seeds 320 old CARD orders (40–60 days ago,
 * so no today / this-month screen or cash drawer sees them) and deletes them.
 */
import { expect, test } from "@playwright/test";
import { commitAdmin, deleteWrite, newSession, queryDocs, tag, updateWrite, type Write,
  serialOnly,
} from "./support";

const SEED = 320;

test("orders: All time shows the newest 300, Load older orders brings the rest", async ({ browser }) => {
  test.setTimeout(180_000);
  serialOnly();
  const run = tag("paging");
  const paths: string[] = [];
  const writes: Write[] = [];
  const base = Date.now() - 40 * 86_400_000;
  for (let i = 0; i < SEED; i++) {
    const id = `${run}-${String(i).padStart(3, "0")}`;
    const path = `orders/${id}`;
    paths.push(path);
    writes.push(
      updateWrite(
        path,
        {
          clientId: id,
          branchId: "main",
          branchName: "Brovo Bites — Main",
          orderNumber: 8_000_000 + i,
          orderType: "takeaway",
          customerName: id,
          items: [{ productId: "d89bjC2jTLBp8Mm6SEaP", productName: "Roti", unitPrice: 25, qty: 1, lineTotal: 25 }],
          subtotal: 25,
          total: 25,
          paymentMethod: "card",
          status: "completed",
          createdBy: "seed",
          createdByName: "E2E Seed",
          createdByEmail: "",
          // one per hour going back from 40 days ago
          createdAt: new Date(base - i * 3_600_000).toISOString(),
        },
        { serverTime: ["syncedAtServer"], exists: false },
      ),
    );
  }
  const seeded = await commitAdmin(writes);
  expect(seeded.status, seeded.body.slice(0, 300)).toBe(200);

  try {
    const total = (await queryDocs("orders", { branchId: "main" })).length;
    expect(total).toBeGreaterThan(300);

    const { context, page } = await newSession(browser, "owner");
    await page.goto("/admin/orders");
    await expect(page.getByRole("heading", { name: "Orders / History", level: 1 })).toBeVisible({ timeout: 30_000 });
    await page.locator(".admin-filter-panel select").first().selectOption("all");

    const count = page.getByText("Total orders", { exact: true }).locator("xpath=following-sibling::p[1]");
    await expect(count).toHaveText("300", { timeout: 30_000 });
    await expect(page.getByText("Showing the newest 300 orders — totals cover these only")).toBeVisible();
    // The newest orders are in the first page; the oldest seeded one is not yet.
    await expect(page.getByRole("button").filter({ hasText: `${run}-000` })).toHaveCount(1);
    await expect(page.getByRole("button").filter({ hasText: `${run}-${SEED - 1}` })).toHaveCount(0);

    await page.getByRole("button", { name: "Load older orders" }).click();
    await expect(count).toHaveText(String(total), { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Load older orders" })).toHaveCount(0);
    await expect(page.getByRole("button").filter({ hasText: `${run}-${SEED - 1}` })).toHaveCount(1);
    await context.close();
  } finally {
    const res = await commitAdmin(paths.map((p) => deleteWrite(p)));
    expect(res.status, res.body.slice(0, 300)).toBe(200);
  }
});
