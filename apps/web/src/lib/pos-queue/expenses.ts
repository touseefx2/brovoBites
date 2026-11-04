import type { AppUser, BusinessDayHours, Expense } from "@bravobites/domain";
import { canDateExpense, canDeleteExpense, canEditExpense, money } from "@bravobites/domain";
import { assertPcClockUsable, shopNow } from "@/lib/shop-clock";
import { putQueuedExpense } from "./db";
import type {
  EnqueueExpenseInput,
  ExpenseFields,
  ExpenseOpKind,
  QueuedExpense,
} from "./types";
import { queuedToExpense } from "./types";

function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function putOp(
  kind: ExpenseOpKind,
  base: Omit<QueuedExpense, "clientId" | "kind" | "occurredAt" | "status" | "enqueuedAt" | "updatedAt"> & {
    clientId?: string;
  },
): Promise<QueuedExpense> {
  const now = Date.now();
  const op: QueuedExpense = {
    ...base,
    clientId: base.clientId ?? newClientId(),
    kind,
    occurredAt: shopNow().toISOString(),
    status: "pending",
    enqueuedAt: now,
    updatedAt: now,
  };
  await putQueuedExpense(op);
  return op;
}

/**
 * Persist expense locally and return it for the UI.
 * Does not touch Firestore — caller must kickSync afterwards.
 */
export async function enqueueExpense(input: EnqueueExpenseInput): Promise<Expense> {
  if (!input.branchId.trim()) throw new Error("Branch is required");
  assertPcClockUsable();
  if (!canDateExpense(input.user, input.date, shopNow().getTime(), input.hours)) {
    throw new Error("Staff can add expenses for today only — ask the owner.");
  }
  const id = newClientId();
  const op = await putOp("create", {
    clientId: id,
    expenseId: id,
    branchId: input.branchId,
    category: input.category,
    description: input.description.trim(),
    amount: money(input.amount),
    date: input.date,
    createdBy: input.user.uid,
    createdByName: input.user.displayName || input.user.email,
    createdAt: shopNow().toISOString(),
    actor: input.user,
  });
  return queuedToExpense(op);
}

/** Queue an edit (works offline). Caller should kickSync(). */
export async function enqueueExpenseEdit(params: {
  expense: Expense;
  changes: ExpenseFields;
  user: AppUser;
  /** Shop hours — staff change their own expenses until that day ends. */
  hours: BusinessDayHours;
}): Promise<Expense> {
  if (params.user.role !== "owner") assertPcClockUsable();
  const now = shopNow().getTime();
  // Staff keep the day it was filed under (the 30-minute grace after close
  // edits it in place); only the owner moves expenses between days.
  const dateOk =
    params.changes.date === params.expense.date ||
    (params.user.role === "owner" && canDateExpense(params.user, params.changes.date, now, params.hours));
  if (!canEditExpense(params.user, params.expense, now, params.hours) || !dateOk) {
    throw new Error("You can change only your own expenses, until the day ends — ask the owner.");
  }
  const { expense, changes } = params;
  const op = await putOp("update", {
    expenseId: expense.id,
    branchId: expense.branchId,
    category: changes.category,
    description: changes.description.trim(),
    amount: money(changes.amount),
    date: changes.date,
    createdBy: expense.createdBy,
    createdByName: expense.createdByName,
    createdAt: expense.createdAt,
    previous: {
      category: expense.category,
      description: expense.description,
      amount: expense.amount,
      date: expense.date,
    },
    actor: params.user,
  });
  return queuedToExpense(op);
}

/** Queue a delete (works offline). Staff: only their own entries. */
export async function enqueueExpenseDelete(params: {
  expense: Expense;
  user: AppUser;
  /** Shop hours — staff delete their own expenses until that day ends. */
  hours: BusinessDayHours;
}): Promise<void> {
  const { expense } = params;
  if (params.user.role !== "owner") assertPcClockUsable();
  if (!canDeleteExpense(params.user, expense, shopNow().getTime(), params.hours)) {
    throw new Error("You can delete only your own expenses, until the day ends — ask the owner.");
  }
  await putOp("delete", {
    expenseId: expense.id,
    branchId: expense.branchId,
    category: expense.category,
    description: expense.description,
    amount: expense.amount,
    date: expense.date,
    createdBy: expense.createdBy,
    createdByName: expense.createdByName,
    createdAt: expense.createdAt,
    actor: params.user,
  });
}
