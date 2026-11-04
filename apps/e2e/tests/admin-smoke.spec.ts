/**
 * Every admin screen loads without an error toast, a "Retry" load error, an
 * uncaught exception or a console error from the app / Firestore
 * (permission-denied, failed-precondition…). Owner first, then staff.
 */
import { expect, test, type Page } from "@playwright/test";
import { isNoise, newSession, watchErrors, type Role } from "./support";

type Screen = { path: string; name: string; extra?: (page: Page) => Promise<void> };

async function settle(page: Page) {
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".spinner")).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(1_500); // late listener errors
}

const SCREENS: Screen[] = [
  { path: "/admin", name: "dashboard" },
  {
    path: "/admin/orders",
    name: "orders (Today → All time → Load older)",
    extra: async (page) => {
      await page.locator(".admin-filter-panel select").first().selectOption("all");
      await settle(page);
      const older = page.getByRole("button", { name: "Load older orders" });
      if (await older.isVisible()) {
        await older.click();
        await settle(page);
      }
      await expect(page.getByText(/^(No orders yet|No orders match your filters)$/).or(page.locator("div.group:has(> button)").first())).toBeVisible();
    },
  },
  {
    path: "/admin/item-sales",
    name: "item sales (+ All time)",
    extra: async (page) => {
      await page.getByRole("button", { name: "All time", exact: true }).click();
      await settle(page);
    },
  },
  { path: "/admin/day-report", name: "day report" },
  {
    path: "/admin/expenses",
    name: "expenses (+ All time)",
    extra: async (page) => {
      await page.getByRole("button", { name: "All time", exact: true }).click();
      await settle(page);
    },
  },
  { path: "/admin/inventory", name: "inventory" },
  { path: "/admin/cash-drawer", name: "cash drawer" },
  {
    path: "/activity",
    name: "activity log (+ All time)",
    extra: async (page) => {
      const range = page.locator("select", { has: page.locator('option[value="all"]', { hasText: "All time" }) });
      if (await range.count()) {
        await range.first().selectOption("all");
        await settle(page);
      }
    },
  },
];

for (const role of ["owner", "staff"] as Role[]) {
  test(`every admin screen loads cleanly as ${role}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const { context, page } = await newSession(browser, role);
    const errs = watchErrors(page);
    const problems: string[] = [];

    for (const screen of SCREENS) {
      await test.step(screen.name, async () => {
        const before = { page: errs.pageErrors.length, console: errs.consoleErrors.length };
        await page.goto(screen.path);
        await settle(page);
        if (screen.extra) await screen.extra(page);
        expect.soft(page).toHaveURL(new RegExp(`${screen.path.replace(/\//g, "\\/")}(\\?|$)`));

        const toasts = await page.locator(".toast-error:visible").allTextContents();
        const retry = await page.getByRole("button", { name: "Retry", exact: true }).count();
        const newPage = errs.pageErrors.slice(before.page);
        const newConsole = errs.consoleErrors.slice(before.console).filter((t) => !isNoise(t));
        for (const t of toasts) problems.push(`${role} ${screen.path}: error toast "${t.trim()}"`);
        if (retry) problems.push(`${role} ${screen.path}: load error with Retry button`);
        for (const t of newPage) problems.push(`${role} ${screen.path}: pageerror ${t}`);
        for (const t of newConsole) problems.push(`${role} ${screen.path}: console.error ${t.slice(0, 500)}`);
      });
    }

    if (errs.consoleWarnings.some((w) => /permission-denied|failed-precondition|index/i.test(w))) {
      problems.push(
        ...errs.consoleWarnings
          .filter((w) => /permission-denied|failed-precondition|index/i.test(w))
          .map((w) => `${role}: console.warn ${w.slice(0, 500)}`),
      );
    }
    if (process.env.E2E_DEBUG) {
      console.log(
        `[${role}] console errors (incl. noise): ${JSON.stringify(errs.consoleErrors, null, 1).slice(0, 4000)}\n` +
          `[${role}] console warnings: ${JSON.stringify(errs.consoleWarnings, null, 1).slice(0, 4000)}`,
      );
    }
    if (problems.length) console.log(problems.join("\n"));
    expect(problems).toEqual([]);
    await context.close();
  });
}
