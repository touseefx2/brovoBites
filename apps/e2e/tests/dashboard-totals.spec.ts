/**
 * Dashboard reads live orders for yesterday + today only; the month card and
 * the chart's "This month" take earlier days from server totals. Both must
 * still equal every non-cancelled order of the month.
 */
import { expect, test } from "@playwright/test";
import {
  commitAdmin,
  deleteWrite,
  karachiDateKey,
  newSession,
  queryDocs,
  shiftDateKey,
  tag,
  updateWrite,
} from "./support";

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-PK")}`;
const ALL_IN_MONTH = "All sales so far are from this month";

function order(id: string, dayKey: string, total: number, status: "completed" | "cancelled") {
  return updateWrite(
    `orders/${id}`,
    {
      clientId: id,
      branchId: "main",
      branchName: "Bravo Bites — Main",
      orderNumber: 9_000_000 + Math.floor(Math.random() * 900_000),
      orderType: "takeaway",
      customerName: id,
      items: [{ productId: "p", productName: "E2E item", unitPrice: total, qty: 1, lineTotal: total }],
      subtotal: total,
      total,
      paymentMethod: "cash",
      status,
      createdBy: "e2e-seed",
      createdByName: "E2E seed",
      createdByEmail: "",
      createdAt: new Date(`${dayKey}T15:00:00+05:00`).toISOString(),
    },
    { serverTime: ["syncedAtServer"], exists: false },
  );
}

test("month card and 'This month' chart count earlier days from server totals", async ({ browser }) => {
  test.setTimeout(150_000);
  const today = karachiDateKey();
  const dayOfMonth = Number(today.slice(8, 10));
  test.skip(dayOfMonth < 4, "needs at least two days of this month before yesterday");

  // Seeded shop day is the calendar day (00:00 → 23:59).
  const old = shiftDateKey(today, -2);
  const ids = [tag("m-old-a"), tag("m-old-b"), tag("m-old-cancelled")];
  const seeded = await commitAdmin([
    order(ids[0]!, old, 1234, "completed"),
    order(ids[1]!, shiftDateKey(today, -3), 766, "completed"),
    order(ids[2]!, old, 5000, "cancelled"),
  ]);
  expect(seeded.status, seeded.body).toBe(200);

  try {
    const monthStart = new Date(`${today.slice(0, 8)}01T00:00:00+05:00`).toISOString();
    const all = await queryDocs("orders", { branchId: "main" });
    const month = all
      .map((d) => d.data)
      .filter((o) => String(o.createdAt) >= monthStart && o.status !== "cancelled");
    const expectedSales = month.reduce((s, o) => s + Number(o.total), 0);

    const { context, page } = await newSession(browser, "owner");
    await page.goto("/admin");
    const card = page.locator("div").filter({ has: page.getByText("This month", { exact: true }) }).filter({
      hasText: "Month orders",
    }).last();
    await expect(card).toContainText(rs(expectedSales), { timeout: 30_000 });
    await expect(card).toContainText(String(month.length));

    // All-time: server totals, also when yesterday and today have no sales.
    // When every sale is from this month the dashboard folds it into the month
    // card ("all sales are this month") instead of a separate card.
    const allActive = all.map((d) => d.data).filter((o) => o.status !== "cancelled");
    const allSales = allActive.reduce((s, o) => s + Number(o.total), 0);
    if (allSales === expectedSales) {
      await expect(card).toContainText(ALL_IN_MONTH, { timeout: 30_000 });
    } else {
      const allTimeCard = page
        .locator("div")
        .filter({ has: page.getByText("All-time sales", { exact: true }) })
        .last();
      await expect(allTimeCard).toContainText(rs(allSales), { timeout: 30_000 });
    }

    // Chart: pick "This month" — earlier days are asked for then.
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.getByRole("button", { name: "This month", exact: true }).click();
    await expect(page.locator("p").filter({ hasText: "Sales by time" })).toContainText(rs(expectedSales), {
      timeout: 30_000,
    });
    await context.close();
  } finally {
    await commitAdmin(ids.map((id) => deleteWrite(`orders/${id}`)));
  }
});
