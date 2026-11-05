# Brovo Bites POS — System Document

> Firebase project ids `brovodev` (DEV) and `borovo-ffc56` (LIVE) are placeholders — `scripts/set-firebase-ids.sh` swaps in the real ids.

## Stack

- **Framework:** Next.js 15.5 (App Router) + React 19 + TypeScript
- **Styling:** Tailwind CSS v4
- **Auth:** Firebase Auth (email/password)
- **Database:** Cloud Firestore (real-time listeners via onSnapshot)
- **Images:** ImageKit CDN
- **Monorepo:** Turborepo + pnpm workspaces
- **Hosting:** Vercel (per environment: admin/POS project + customer landing project)
- **Receipt:** 80mm thermal printer (browser print, 2 copies)
- **i18n:** English + Urdu (RTL) — all strings in `dictionaries.ts`

## Architecture

```
brovoBites/
├── apps/web/          → Next.js app (all UI + API routes)
│   ├── src/app/       → Pages (App Router)
│   ├── src/components → Reusable components
│   ├── src/lib/       → Firestore CRUD, auth, helpers
│   └── src/i18n/      → Bilingual dictionaries
├── packages/domain/   → Pure TypeScript (types, cart, permissions, money)
│   └── src/           → types.ts, access.ts, cart.ts, money.ts
└── firestore.rules    → Security rules
```

### Key Files

| File | Purpose |
|---|---|
| `packages/domain/src/types.ts` | All domain interfaces (Order, Product, Expense, Inventory, StaffPermissions, etc.) |
| `packages/domain/src/access.ts` | Permission functions (canEditOrder, canManageInventory, canApplyDiscount, etc.) |
| `packages/domain/src/cart.ts` | Cart operations (add, remove, totals, toOrderItems) |
| `packages/domain/src/money.ts` | `money()` rounding helper, `formatPkr()` display |
| `apps/web/src/lib/firestore.ts` | All Firestore CRUD + real-time snapshot listeners |
| `apps/web/src/lib/auth-context.tsx` | Auth provider, login/logout, profile with permissions, branch gate |
| `apps/web/src/lib/print-receipt.ts` | Thermal receipt HTML generation (Branch Copy + Customer Copy) |
| `apps/web/src/i18n/dictionaries.ts` | All UI strings (en + ur), exports `MessageKey` type |
| `apps/web/src/middleware.ts` | Customer domain redirect (blocks admin/login/pos) |
| `apps/web/src/components/AdminShell.tsx` | Admin layout (sidebar nav, role-based menu items) |

## Two Roles

### Owner (Admin)
Full system access. Can manage menu, staff, branches, settings. Can edit/delete/refund any order. Can edit/delete expenses. Can delete inventory items.

### Staff (Counter)
POS + limited admin access. 6 configurable permissions (all default ON):

| Permission | What it controls |
|---|---|
| `canAddExpenses` | Can add today's expenses, and edit their own until the business day ends |
| `canDeleteExpenses` | Can delete their own expenses until the business day ends |
| `canApplyDiscount` | Can apply a discount of any amount at checkout (logged) |
| `canEditOrders` | Can edit own orders until the business day ends (at least 30 minutes) |
| `canCancelOrders` | Can cancel or refund own orders until the business day ends (at least 30 minutes) |
| `canManageInventory` | Can add/edit/delete inventory items and record stock movements in their own branch (logged) |

Staff limitations (hardcoded, not toggleable):
- See every order of their own branch (not other branches)
- Cannot delete orders or other people's expenses
- Refund only their own orders, until the business day ends (cancel permission)
- Cannot change menu, branches, staff, or settings
- Edit/cancel own orders only until the business day ends (at least 30 minutes)

## Firestore Collections

| Collection | Documents |
|---|---|
| `users` | `{ uid, email, displayName, phone, role, branchIds, isActive, permissions?, createdAt }` |
| `branches` | `{ name, phone, address, latitude?, longitude?, isActive, createdAt }` |
| `categories` | `{ branchId, name, imageUrl, sortOrder, isActive }` — menu is shared by all branches (`branchId: "shared"`) |
| `products` | `{ branchId, categoryId, name, type, basePrice, variations[], dealItems[], imageUrl, compareAtPrice, isActive, sortOrder }` |
| `orders` | `{ branchId, branchName?, items[], total, subtotal, status, orderType, paymentMethod, createdBy, createdByName, orderNumber, taxAmount?, deliveryCharges?, discountType?, discountValue?, discountAmount?, refundAmount?, refundReason?, note? }` |
| `counters` | `global` doc: `{ lastOrderNumber }` — one order-number sequence for all branches |
| `settings` | `{ shopName, phone, currency, slogan, eyebrow, logoUrl, copyrightName, heroSlides[], whatsappNumber, taxPercent, deliveryCharges, businessDayStart, businessDayEnd, receiptPaper, … }` |
| `expenses` | `{ branchId, category, description, amount, date, createdBy, createdByName, createdAt }` |
| `inventory` | `{ branchId, productId, productName, description?, currentStock, lowStockThreshold, unit }` |
| `stockMovements` | `{ branchId, inventoryItemId, productId, productName, movementType, quantity, previousStock, newStock, notes?, createdBy, createdByName, createdAt }` |
| `cashDrawers` | `{ branchId, openedBy, openedByName, openedAt, openingBalance, closedAt?, closingBalance?, closedBy?, closedByName? }` |

## Real-Time Listeners

All use `onSnapshot` with proper cleanup on component unmount:

| Page | Listens to | Why |
|---|---|---|
| Dashboard | orders | Live today's sales count |
| POS | settings, categories, products | Menu/price changes reflect instantly |
| Orders | orders | New orders appear live |
| Expenses | expenses | Staff-added expenses show for owner |
| Inventory | inventory, stockMovements | Stock levels update on sale |
| Item Sales | orders | Sales breakdown updates live |
| Day Report | orders, expenses | Report stays current |
| Cash Drawer | cashDrawers, orders, expenses | Expected cash auto-calculates |

## API Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/admin/users` | POST | Owner | Create staff (Firebase Auth + Firestore user doc) |
| `/api/admin/users` | PATCH | Owner | Update staff (name, phone, branch, password, permissions) |
| `/api/upload-menu-image` | POST | Owner | Upload product/category image to ImageKit |
| `/api/public/branches-staff` | GET | Public | Branch + staff data for landing page |

## Important Patterns

### Backward-compatible permissions
```typescript
user.permissions?.canEditOrders !== false
```
If `permissions` field is undefined (old users), all permissions default to `true`.

### Currency rounding
```typescript
money(value)  // rounds to nearest integer (PKR has no decimals in POS context)
formatPkr(n)  // "Rs 1,500"
```

### Fire-and-forget stock deduction
When a POS order is placed, stock is deducted from inventory after checkout completes — not blocking the checkout flow.

### Order number auto-increment
Uses a Firestore transaction on `/counters/global` to atomically increment one shared order-number sequence.

### Receipt printing
`print-receipt.ts` generates HTML for 80mm thermal paper. Two copies printed: Branch Copy (for kitchen) + Customer Copy. Includes item notes, discount line, tax, delivery charges.

## Deployment

Each environment (DEV and LIVE, in separate Vercel accounts) has two Vercel projects deployed from the same repo:
- **Admin / POS** (e.g. `brovodev`, `borovo-ffc56`) — full POS + Admin access
- **Customer menu** (`brovobites` / `brovobites-dev`) — landing page only (`NEXT_PUBLIC_CUSTOMER_MODE=true`; middleware blocks admin routes)

See [DEPLOYMENT.md](../DEPLOYMENT.md) for deploy commands, env vars, and domain setup.

## Security / Anti-Fraud Summary

1. **Business-day edit window** for staff on their own orders (at least 30 minutes)
2. **Staff see only their own branch**
3. **Cash Drawer auto-tracking** (cash orders auto-counted, closing difference shown)
4. **Discount permission** per staff member (any amount when on, logged)
5. **Refunds**: owner any order; staff only their own, the same business day (cancel permission), logged
6. **Expense delete** = owner any, staff only their own (permission, logged)
7. **Inventory delete** = owner, or staff with inventory permission in their own branch (logged)
8. **All expenses track who added them** ("Added by [name]")
9. **Per-staff permission toggles** (owner can restrict individual staff)
10. **Firestore rules enforce** the same limits server-side (branch-scoped reads, staff write only in their own name, 24h server cap on the staff window, staff refunds only on their own order — refund fields only, more than before, at most the total, one new log entry for exactly that amount — staff expenses dated today and kept on their day, discount permission, non-negative amounts, order counter only moves up). Client UI is not the only check.
