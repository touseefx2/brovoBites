/**
 * Stock with a real inventory row: a POS sale deducts it (it may go below 0 —
 * oversold shows as negative instead of blocking the sale), and a cancel puts
 * back exactly what the sale took. Movements use fixed ids (no double counting).
 */
import { expect, test } from "@playwright/test";
import {
  acknowledgeSuccess,
  commitAdmin,
  confirmAlert,
  deleteWrite,
  getDoc,
  newSession,
  ownerToken,
  Pos,
  queryDocs,
  staffToken,
  tag,
  updateWrite,
} from "./support";

const PRODUCT = "Kebab Spring Roll"; // simple product, Rs 450 (its id changes with every seed)

test("sale deducts inventory below zero; cancel restocks it", async ({ browser }) => {
  test.setTimeout(180_000);
  const staff = await staffToken();
  const owner = await ownerToken();
  const [product] = await queryDocs("products", { name: PRODUCT });
  expect(product, `${PRODUCT} is in the seeded menu`).toBeTruthy();
  const PRODUCT_ID = product!.id;
  expect(await queryDocs("inventory", { branchId: "main", productId: PRODUCT_ID })).toHaveLength(0);

  const invId = tag("inv");
  const invPath = `inventory/${invId}`;
  const cleanup = [invPath];
  const seeded = await commitAdmin([
    updateWrite(
      invPath,
      {
        branchId: "main",
        productId: PRODUCT_ID,
        productName: PRODUCT,
        currentStock: 2,
        lowStockThreshold: 5,
        unit: "pcs",
        lastUpdated: new Date().toISOString(),
        createdBy: owner.uid,
        createdByName: "E2E Owner",
        createdAt: new Date().toISOString(),
      },
      { serverTime: ["lastUpdatedServer"], exists: false },
    ),
  ]);
  expect(seeded.status, seeded.body).toBe(200);

  try {
    const { context, page } = await newSession(browser, "staff");
    const pos = new Pos(page);
    await pos.goto();
    for (let i = 0; i < 3; i++) await pos.addProduct(PRODUCT);
    const customer = tag("stock-sale");
    const sale = await pos.sell(PRODUCT, customer); // 4th unit added inside sell()
    expect(sale.data.total).toBe(4 * 450);
    await pos.waitAllSynced(60_000);

    // 2 in stock − 4 sold = −2 (oversold, not blocked)
    await expect
      .poll(async () => (await getDoc(invPath))?.data.currentStock, { timeout: 30_000 })
      .toBe(-2);
    const salePath = `stockMovements/${sale.id}__${PRODUCT_ID}`;
    cleanup.push(salePath);
    const saleMove = await getDoc(salePath);
    expect(saleMove?.data).toMatchObject({
      movementType: "sale",
      quantity: 4,
      previousStock: 2,
      newStock: -2,
      createdBy: staff.uid,
    });

    // Inventory screen shows the oversold count.
    await page.goto("/admin/inventory");
    const row = page.locator("div, li, tr").filter({ hasText: PRODUCT }).filter({ hasText: "-2" });
    await expect(row.first()).toBeVisible({ timeout: 30_000 });
    await expect(row.first()).toContainText("Out of stock");

    // Cancel → +4 back.
    await pos.goto();
    const sheet = await pos.openOrder(customer);
    await sheet.getByRole("button", { name: "Cancel this order" }).click();
    await confirmAlert(page, "Cancel this order?");
    await acknowledgeSuccess(page, "Order cancelled");
    await expect
      .poll(async () => (await getDoc(invPath))?.data.currentStock, { timeout: 45_000 })
      .toBe(2);
    const restockPath = `stockMovements/restock_${sale.id}__${PRODUCT_ID}`;
    cleanup.push(restockPath);
    expect((await getDoc(restockPath))?.data).toMatchObject({
      movementType: "restock",
      quantity: 4,
      previousStock: -2,
      newStock: 2,
    });
    await pos.waitAllSynced(60_000);
    // Nothing applied twice.
    expect((await getDoc(invPath))?.data.currentStock).toBe(2);
    await context.close();
  } finally {
    await commitAdmin(cleanup.map((p) => deleteWrite(p)));
  }
});
