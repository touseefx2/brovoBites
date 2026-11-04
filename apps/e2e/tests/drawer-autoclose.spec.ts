/**
 * A drawer left open past its business day closes by itself when someone opens
 * the Cash Drawer screen online — also from a STAFF login, which the new rules
 * allow only as a system close with no hand count (closingCount / difference
 * null). (The previous app version wrote count = expected; the new rules
 * refuse that from staff.)
 */
import { expect, test } from "@playwright/test";
import {
  commitAdmin,
  deleteWrite,
  getDoc,
  karachiDateKey,
  newSession,
  queryDocs,
  shiftDateKey,
  staffToken,
  tag,
  updateWrite,
  serialOnly,
} from "./support";

test("yesterday's open drawer is auto-closed (no count) when staff opens the drawer screen", async ({ browser }) => {
  test.setTimeout(120_000);
  serialOnly();
  const staff = await staffToken();
  const yesterday = shiftDateKey(karachiDateKey(), -1);
  const id = tag("autoclose-drawer");
  const path = `cashDrawers/${id}`;
  const openedAt = new Date(`${yesterday}T12:00:00+05:00`);

  expect(await queryDocs("cashDrawers", { branchId: "main", status: "open" }), "no drawer open before").toHaveLength(0);
  const seeded = await commitAdmin([
    updateWrite(
      path,
      {
        branchId: "main",
        date: yesterday,
        openingBalance: 100,
        closingCount: null,
        expectedCash: null,
        difference: null,
        status: "open",
        openedBy: staff.uid,
        openedByName: "E2E Staff",
        openedAt: openedAt.toISOString(),
        createdAtServer: openedAt,
      },
      { exists: false },
    ),
  ]);
  expect(seeded.status, seeded.body).toBe(200);

  try {
    // Yesterday's cash activity the close must account for (normally none).
    const from = Date.parse(`${yesterday}T00:00:00+05:00`);
    const to = Date.parse(`${yesterday}T23:59:59.999+05:00`);
    const inDay = (iso: unknown) => {
      const t = Date.parse(String(iso));
      return t >= from && t <= to;
    };
    const orders = (await queryDocs("orders", { branchId: "main", paymentMethod: "cash" })).filter(
      (o) => o.data.status !== "cancelled",
    );
    const sales = orders.filter((o) => inDay(o.data.createdAt)).reduce((s, o) => s + Number(o.data.total), 0);
    const refunds = orders
      .flatMap((o) => (o.data.refunds as { amount: number; at: string }[] | undefined) ?? [])
      .filter((r) => inDay(r.at))
      .reduce((s, r) => s + r.amount, 0);
    const expenses = (await queryDocs("expenses", { branchId: "main", date: yesterday })).reduce(
      (s, e) => s + Number(e.data.amount),
      0,
    );
    const expected = 100 + sales - refunds - expenses;

    const { context, page } = await newSession(browser, "staff");
    await page.goto("/admin/cash-drawer");
    await expect(page.getByText("Drawer was auto-closed at business day end.")).toBeVisible({ timeout: 45_000 });
    await expect
      .poll(async () => (await getDoc(path))?.data, { timeout: 30_000, intervals: [500, 1000] })
      .toMatchObject({
        status: "closed",
        closedBy: "system",
        autoClosed: true,
        closingCount: null,
        difference: null,
        expectedCash: expected,
        openingBalance: 100,
      });
    await expect(page.locator(".toast-error")).toHaveCount(0);
    const closedList = page.locator("section").filter({ has: page.getByRole("heading", { name: "Drawer closed" }) });
    const row = closedList.locator("div.flex.items-center.justify-between").filter({ hasText: yesterday });
    await expect(row.first()).toContainText("not counted");
    await expect(row.first()).toContainText("Auto close (day end)");
    await context.close();
  } finally {
    await commitAdmin([deleteWrite(path)]);
  }
});
