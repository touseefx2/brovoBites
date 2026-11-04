/**
 * Staff on THEIR OWN orders: add/edit, refund (partial cancel) and cancel
 * until the business day ends — never delete. Someone else's (owner's) order
 * is read-only for staff, in the UI and on the server.
 */
import { expect, test } from "@playwright/test";
import {
  acknowledgeSuccess,
  commitAs,
  confirmAlert,
  deleteWrite,
  getDoc,
  newSession,
  orderSheet,
  ownerToken,
  Pos,
  queryDocs,
  staffToken,
  tag,
  updateWrite,
  waitForOne,
} from "./support";

test.describe("staff order policy", () => {
  test("staff edits (adds an item) and partly refunds their own sale — no delete control", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const staff = await staffToken();
    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();

    const customer = tag("staff-edit");
    const sale = await pos.sell("Classic Zinger", customer);
    expect(sale.data.createdBy).toBe(staff.uid);
    expect(sale.data.total).toBe(380);
    expect(sale.data.status).toBe("completed");
    // Sale + its stock step fully uploaded (refund refuses a sale still syncing).
    await pos.waitAllSynced(45_000);

    // ── Edit: add Mint Margarita (Rs 200) ──
    let sheet = await pos.openOrder(customer);
    await expect(sheet.getByRole("button", { name: "Delete order" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Refund order" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Cancel this order" })).toBeVisible();

    await sheet.getByRole("button", { name: "Add item", exact: true }).click();
    await sheet.getByPlaceholder("Search menu…").fill("Mint Margarita");
    await sheet.getByRole("button", { name: /Mint Margarita/ }).first().click();
    await expect(sheet.locator("footer")).toContainText("Rs 580");
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await confirmAlert(page, "Save order changes?");
    await acknowledgeSuccess(page, "Order updated");
    await expect(sheet).toBeHidden();

    const edited = await waitForOne("orders", { customerName: customer }, (d) => d.data.total === 580);
    const items = edited.data.items as { productName: string; qty: number }[];
    expect(items.map((i) => i.productName).sort()).toEqual(["Classic Zinger", "Mint Margarita"]);
    expect(edited.data.updatedBy).toBe(staff.uid);
    expect(edited.data.subtotal).toBe(580);
    await pos.waitAllSynced(45_000);

    // ── Partial refund Rs 100 ──
    sheet = await pos.openOrder(customer);
    await expect(sheet.getByRole("button", { name: "Delete order" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Refund order" }).click();
    await sheet.locator('input[type="number"]').fill("100");
    await sheet.getByPlaceholder("e.g. wrong item, quality issue").fill("E2E partial refund");
    await sheet.getByRole("button", { name: "Confirm refund" }).click();
    await confirmAlert(page, "Confirm this refund?");
    await acknowledgeSuccess(page, "Refund processed");

    const refunded = await waitForOne(
      "orders",
      { customerName: customer },
      (d) => d.data.refundAmount === 100,
    );
    expect(refunded.data.status).toBe("completed");
    expect(refunded.data.total).toBe(580);
    expect(refunded.data.refundedBy).toBe(staff.uid);
    expect(refunded.data.refundCount).toBe(1);
    const ledger = refunded.data.refunds as { amount: number; at: string }[];
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.amount).toBe(100);
    expect(Number.isFinite(Date.parse(ledger[0]!.at))).toBe(true);
    await pos.waitAllSynced(45_000);

    // A refunded order can't be edited any more, but the rest can still be refunded / cancelled.
    sheet = await pos.openOrder(customer);
    await expect(sheet).toContainText("Refunded: Rs 100");
    await expect(sheet).toContainText("This order has a refund, so it can't be edited.");
    await expect(sheet.getByRole("button", { name: "Add item", exact: true })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Refund order" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Delete order" })).toHaveCount(0);

    // Server: staff can never delete, even their own order.
    const del = await commitAs(staff.idToken, [deleteWrite(`orders/${sale.id}`)]);
    expect(del.status, del.body).toBe(403);
    expect(await getDoc(`orders/${sale.id}`)).not.toBeNull();

    // The activity log keeps the bill before / after the edit, and the refund.
    type Bill = { total: number; items: { name: string; qty: number }[] };
    const logs = (await queryDocs("activityLogs", { entityId: sale.id })).map((d) => d.data);
    const editLog = logs.find((l) => String(l.summary).startsWith("Edited order"));
    const change = editLog?.change as { before: Bill; after: Bill } | undefined;
    expect(change?.before.total).toBe(380);
    expect(change?.after.total).toBe(580);
    expect(change?.after.items.map((i) => i.name)).toContain("Mint Margarita");
    const refundLog = logs.find((l) => String(l.summary).startsWith("Refunded order"));
    expect((refundLog?.change as { refund?: unknown } | undefined)?.refund).toMatchObject({
      amount: 100,
      reason: "E2E partial refund",
    });

    // …and shows it plainly in the POS log popup (Report → Orders → activity log).
    await orderSheet(page).locator("header").getByRole("button", { name: "Close" }).click();
    await expect(orderSheet(page)).toBeHidden();
    await pos.toolbar().locator("button", { hasText: "Report" }).click();
    const report = page.getByRole("dialog", { name: "Day End Report" });
    await report.getByRole("tab", { name: /Orders/ }).click();
    await report.getByRole("button", { name: /See activity log/ }).click();
    const logDlg = page.getByRole("dialog", { name: "Order activity" });
    const num = String(sale.data.orderNumber);
    const editRow = logDlg.locator("li").filter({ hasText: `Order #${num}` }).filter({ hasText: "What changed" });
    await expect(editRow).toContainText("Added: Mint Margarita ×1", { timeout: 30_000 });
    await expect(editRow).toContainText("Rs 200 more");
    await editRow.getByRole("button", { name: /Show full bill/ }).click();
    await expect(editRow).toContainText("Before");
    await expect(editRow).toContainText("After");
    const refundRow = logDlg.locator("li").filter({ hasText: `Order #${num}` }).filter({ hasText: "E2E partial refund" });
    await expect(refundRow).toContainText("Rs 100");

    await context.close();
  });

  test("staff cancels their own sale — no delete control", async ({ browser }) => {
    test.setTimeout(150_000);
    const staff = await staffToken();
    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();

    const customer = tag("staff-cancel");
    const sale = await pos.sell("Chicken Club", customer);
    expect(sale.data.createdBy).toBe(staff.uid);
    await pos.waitAllSynced(45_000);

    const sheet = await pos.openOrder(customer);
    await expect(sheet.getByRole("button", { name: "Delete order" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Cancel this order" }).click();
    await confirmAlert(page, "Cancel this order?");
    await acknowledgeSuccess(page, "Order cancelled");

    const cancelled = await waitForOne(
      "orders",
      { customerName: customer },
      (d) => d.data.status === "cancelled",
    );
    expect(cancelled.data.updatedBy).toBe(staff.uid);
    expect(cancelled.data.createdBy).toBe(staff.uid);

    // The cancelled order: no more actions for staff (and never delete).
    const again = await pos.openOrder(customer);
    for (const name of ["Refund order", "Cancel this order", "Delete order", "Save changes"]) {
      await expect(again.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
    await context.close();
  });

  test("an order made by the owner is read-only for staff (UI + server)", async ({ browser }) => {
    test.setTimeout(180_000);
    const staff = await staffToken();
    const owner = await ownerToken();

    // Owner sells on their own POS session.
    const ownerSession = await newSession(browser, "owner");
    const ownerPos = new Pos(ownerSession.page);
    await ownerPos.goto();
    const customer = tag("owner-sale");
    const ownerSale = await ownerPos.sell("Naan", customer);
    expect(ownerSale.data.createdBy).toBe(owner.uid);
    await ownerSession.context.close();

    // Staff opens it from Recent orders: no edit / refund / cancel / delete.
    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();
    const sheet = await pos.openOrder(customer);
    await expect(sheet).toContainText("Only the owner can edit orders");
    for (const name of ["Add item", "Save changes", "Refund order", "Cancel this order", "Delete order"]) {
      await expect(sheet.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
    await expect(sheet.getByText("Order actions")).toHaveCount(0);

    // Same order through the admin Orders page (staff view).
    await page.goto("/admin/orders");
    const card = page.getByRole("button").filter({ hasText: customer });
    await expect(card).toHaveCount(1, { timeout: 30_000 });
    await card.click();
    const adminSheet = orderSheet(page);
    await expect(adminSheet).toBeVisible();
    for (const name of ["Add item", "Refund order", "Cancel this order", "Delete order"]) {
      await expect(adminSheet.getByRole("button", { name, exact: true })).toHaveCount(0);
    }

    // Server refuses the same changes made directly (DevTools / old client).
    const path = `orders/${ownerSale.id}`;
    const cancel = await commitAs(staff.idToken, [
      updateWrite(path, { status: "cancelled", updatedBy: staff.uid }, { mask: ["status", "updatedBy"] }),
    ]);
    expect(cancel.status, cancel.body).toBe(403);
    const refund = await commitAs(staff.idToken, [
      updateWrite(
        path,
        {
          refundAmount: 10,
          refundedBy: staff.uid,
          refundCount: 1,
          refunds: [{ amount: 10, at: new Date().toISOString() }],
        },
        { mask: ["refundAmount", "refundedBy", "refundCount", "refunds"] },
      ),
    ]);
    expect(refund.status, refund.body).toBe(403);
    const edit = await commitAs(staff.idToken, [
      updateWrite(path, { customerPhone: "0300", updatedBy: staff.uid }, { mask: ["customerPhone", "updatedBy"] }),
    ]);
    expect(edit.status, edit.body).toBe(403);
    const del = await commitAs(staff.idToken, [deleteWrite(path)]);
    expect(del.status, del.body).toBe(403);

    const after = await getDoc(path);
    expect(after?.data.status).toBe("completed");
    expect(after?.data.refundAmount).toBeUndefined();
    await context.close();
  });
});
