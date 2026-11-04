import type { ExpenseCategory } from "@bravobites/domain";
import type { MessageKey } from "@/i18n/dictionaries";

export const expenseCategoryLabelKey: Record<ExpenseCategory, MessageKey> = {
  rent: "expenseRent",
  salaries: "expenseSalaries",
  utilities: "expenseUtilities",
  supplies: "expenseSupplies",
  maintenance: "expenseMaintenance",
  transport: "expenseTransport",
  marketing: "expenseMarketing",
  other: "expenseOther",
};
