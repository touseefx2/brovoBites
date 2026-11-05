# Brovo Bites POS System

Production **Point of Sale + Admin** system for **Brovo Bites**, a multi-branch restaurant.

> **Firebase project ids:** `brovodev` (DEV) and `borovo-ffc56` (LIVE) used throughout this repo are placeholders.
> Once your Firebase projects exist, run `bash scripts/set-firebase-ids.sh <dev-project-id> <live-project-id>` to swap them in.

## Tech Stack

| Layer | Tech | Version |
|---|---|---|
| Framework | Next.js (App Router) | 15.5 |
| Language | TypeScript | 5.x |
| UI | React | 19 |
| Styling | Tailwind CSS | v4 |
| Auth | Firebase Auth (email/password) | 12.x |
| Database | Cloud Firestore (real-time) | 12.x |
| Images | ImageKit CDN (menu/category photos) | — |
| Monorepo | Turborepo + pnpm workspaces | — |
| Hosting | Vercel (admin + customer project per environment) | — |
| Printer | 80mm thermal via browser print | — |
| i18n | English + Urdu (RTL) | custom |

## Monorepo Structure

```
brovoBites/
├── apps/
│   ├── e2e/                          # Playwright end-to-end tests
│   └── web/                          # Next.js app (POS + Admin + Landing)
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx        # Root layout + providers
│       │   │   ├── page.tsx          # Landing page (public)
│       │   │   ├── login/            # Auth login page
│       │   │   ├── pos/              # POS screen (opens in new tab)
│       │   │   └── admin/
│       │   │       ├── page.tsx      # Dashboard (today's sales)
│       │   │       ├── branches/     # Branch CRUD (owner only)
│       │   │       ├── menu/         # Menu grid (all roles) + category/product CRUD (owner only)
│       │   │       ├── view-menu/    # Legacy route → redirects to /admin/menu
│       │   │       ├── staff/        # Staff CRUD + permissions (owner only)
│       │   │       ├── orders/       # Order history, edit, cancel, refund
│       │   │       ├── expenses/     # Daily expense tracking
│       │   │       ├── inventory/    # Stock management
│       │   │       ├── item-sales/   # Item-wise sales report
│       │   │       ├── day-report/   # Day-end summary
│       │   │       ├── cash-drawer/  # Shift-wise cash tracking
│       │   │       ├── owner-report/ # Owner report (on screen + daily email)
│       │   │       └── landing/      # Landing page settings (owner only)
│       │   ├── components/           # Shared React components
│       │   ├── lib/
│       │   │   ├── firestore.ts      # All Firestore CRUD + real-time listeners
│       │   │   ├── auth-context.tsx  # Auth provider (login, profile, branch gate)
│       │   │   ├── firebase/         # Firebase client + admin init
│       │   │   ├── print-receipt.ts  # Thermal receipt generation (2 copies)
│       │   │   └── errors.ts         # Firebase error mapping (bilingual)
│       │   ├── i18n/
│       │   │   ├── dictionaries.ts   # All UI strings (en + ur)
│       │   │   └── locale-context.tsx # Language context + RTL support
│       │   └── middleware.ts         # Customer domain redirect
│       └── vercel.json               # Vercel config (Git deploys off, report crons)
├── packages/
│   ├── domain/                       # Shared business logic (pure TS, unit tested)
│   │   └── src/
│   │       ├── types.ts              # All domain types + interfaces
│   │       ├── access.ts             # Permission functions + role checks
│   │       ├── cart.ts               # Cart operations (add, remove, totals)
│   │       ├── money.ts              # Currency rounding helper
│   │       └── index.ts              # Barrel exports
│   └── rules-tests/                  # Firestore rules tests (emulator)
├── scripts/                          # Deploy, ship, set-firebase-ids, e2e helpers
├── deploy/                           # Vercel deploy targets template
├── firestore.rules                   # Firestore security rules
├── turbo.json                        # Turborepo config
├── pnpm-workspace.yaml               # Workspace definition
├── DEPLOYMENT.md                     # Deployment guide
└── docs/
    ├── ENV-SETUP.md                  # Environment variable setup guide
    ├── SYSTEM.md                     # System overview
    ├── erd.md                        # Entity Relationship Diagram
    └── guide/guide.html              # User guide for owner + staff (Roman Urdu)
```

## Two User Roles

### Owner (Admin)
Full access to everything — menu, staff, branches, all reports, refunds, delete.

### Staff (Counter)
Limited POS access with configurable permissions:

| Feature | Owner | Staff |
|---|---|---|
| POS orders | Always | Always |
| Edit own orders | Always | Until the business day ends (at least 30 min) + permission |
| Cancel own orders | Always | Until the business day ends (at least 30 min) + permission |
| Delete orders | Yes | No |
| Apply discount | Unlimited | Any amount + permission (logged) |
| Refund | Yes | Own orders, until the business day ends + cancel permission |
| Add expenses | Any day | Today only + permission |
| Edit/Delete expenses | Any | Own expenses, until the business day ends + permission |
| Manage inventory | Yes | Permission toggle |
| Delete inventory | Yes | Own branch + inventory permission (logged) |
| Menu/Branches/Staff | Yes | No |
| Day Report | All branches | Own branch |
| Orders visibility | All branches | All orders of own branch |

### Staff Permissions (6 toggles per staff member)

```typescript
interface StaffPermissions {
  canAddExpenses: boolean;      // default: true
  canDeleteExpenses: boolean;   // default: true (own expenses only)
  canApplyDiscount: boolean;    // default: true
  canEditOrders: boolean;       // default: true
  canCancelOrders: boolean;     // default: true
  canManageInventory: boolean;  // default: true
}
```

Owner sets these on Staff → Add/Edit page. `!== false` pattern means existing staff without permissions field get all permissions (backward compatible).

## Key Constants

```typescript
STAFF_EDIT_GRACE_MS = 30 * 60 * 1000    // staff own-order edit/cancel: until the business day ends, at least 30 min
```

## Features

### POS (Point of Sale)
- Category → Product selection, sized products (S/M/L), deals/bundles
- Cart with quantity +/-, per-item notes ("Extra raita", "No onion")
- Checkout: order type (Dine-in/Takeaway/Delivery), payment method (Cash/Card/Digital)
- Discount at checkout (% or fixed amount)
- Tax % and delivery charges (from settings)
- 2-copy receipt printing (Branch Copy + Customer Copy) via 80mm thermal
- Opens in separate browser tab from admin

### Orders
- Search by order #, cashier name, or item
- Date filters: Today, Yesterday, Last 7 Days, This Month, Custom, All Time
- Status filters: All, Original, Edited, Cancelled, Refunded
- Edit order (add/remove items), Cancel, Reprint receipt
- Refund (owner only) — partial or full, reason required
- Delete (owner only)

### Menu Management (Owner Only)
- Categories with cover images
- Products: Simple (fixed price), Sized (variations), Bundle/Deal
- Product images via ImageKit CDN
- Hide/Show products and categories
- Compare-at-price for deals (strikethrough)

### Expenses
- 8 categories: Rent, Salaries, Utilities, Supplies, Maintenance, Transport, Marketing, Other
- Staff can add (with permission), Owner can add/edit/delete
- "Added by [name]" tracking on each expense
- Date + branch filters

### Inventory
- Two entry modes: "From menu" (auto stock deduction on sale) and "Manual entry" (custom items)
- Low stock alerts with configurable thresholds
- Stock movements: Purchase (+), Waste (−), Adjustment, Sale (auto)
- Units: Pieces, Kg, Liters, Dozen, Box, Bag
- Description field for item details
- Color-coded: Green (OK), Amber (Low), Red (Out of stock)

### Day-End Report
- Total Sales, Expenses, Discounts, Refunds
- Net Profit = Sales − Expenses − Refunds
- Payment breakdown (Cash / Card / Digital)
- Staff sales breakdown (owner only)
- Active vs Cancelled order counts

### Cash Drawer
- Open drawer with opening balance → auto-track cash sales/expenses/refunds → close with count
- Expected vs Actual cash with difference indicator
- Color-coded: Green (match), Red (short), Orange (over)

### Bilingual (i18n)
- English + Urdu with full RTL support
- One-click language toggle in sidebar
- All UI strings in `apps/web/src/i18n/dictionaries.ts` as `MessageKey` type

### Real-Time Listeners (Firebase onSnapshot)
All properly cleaned up on unmount (no memory leaks):
- Dashboard: orders (today's sales)
- POS: settings + categories + products
- Orders: order list
- Expenses: expense list
- Inventory: stock levels + movements
- Item Sales: orders (for breakdown)
- Day Report: orders + expenses
- Cash Drawer: sessions + orders + expenses

## Firebase Collections

| Collection | Description |
|---|---|
| `users` | Owner + Staff profiles, permissions |
| `branches` | Shop locations |
| `categories` | Menu categories |
| `products` | Menu products (simple/sized/bundle) |
| `orders` | All orders with items, payment, discount, refund |
| `counters` | Auto-increment order numbers |
| `settings` | Shop settings (name, tax, delivery, branding) |
| `expenses` | Daily expense records |
| `inventory` | Stock items with levels |
| `stockMovements` | Stock change history (purchase/sale/waste/adjust) |
| `cashDrawers` | Cash drawer sessions (open/close with counts) |

## Quick Start (Development)

```bash
cd brovoBites
pnpm install

# Create the env files (never committed):
#   apps/web/.env.development.local  (+ the same values in apps/web/.env.local)
# Fill them with your brovodev Firebase + ImageKit keys (see docs/ENV-SETUP.md)

pnpm --filter web dev
# Open http://localhost:3001
```

### First-time setup (DEV)
```bash
# Safest: create Auth + owner profile in brovodev
pnpm create-owner -- --email=you@email.com --password='DevPass123' --name=Owner --primary
# Login at localhost:3001/login

# Optional: seed sample menu/branch on DEV only
pnpm seed -- --ownerUid=PASTE_UID --ownerEmail=you@email.com --ownerName=Owner
```

### First-time LIVE owner
```bash
SEED_ENV=production pnpm create-owner -- \
  --email=you@email.com --password='StrongPass' --name=Owner \
  --confirm=borovo-ffc56 --primary
```
See [DEPLOYMENT.md](DEPLOYMENT.md).

## Scripts

| Command | What |
|---|---|
| `pnpm --filter web dev` | Dev server → localhost:3001 (**dev** Firebase) |
| `pnpm --filter web build` | Production build |
| `pnpm test` | Unit tests (domain package) |
| `pnpm create-owner -- ...` | Auth + owner Firestore doc (safe; LIVE needs `--confirm=`) |
| `pnpm seed -- --ownerUid=...` | Seed menu + branch (**dev** by default) |
| `pnpm deploy:dev` | Deploy admin site → DEV Vercel |
| `pnpm deploy:live` | Deploy admin site → LIVE Vercel (confirm) |
| `pnpm deploy:dev:customer` / `pnpm deploy:live:customer` | Deploy customer menu site |
| `npx turbo build` | Build all packages |

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/admin/users` | POST | Create staff user (owner only) |
| `/api/admin/users` | PATCH | Update staff user (owner only) |
| `/api/upload-menu-image` | POST | Upload product/category image |
| `/api/public/branches-staff` | GET | Public branch + staff data |

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for full deployment guide including:
- Two Vercel projects per environment (admin/POS + customer menu), DEV and LIVE in separate Vercel accounts
- Environment variables
- Deploy commands
- Custom domain setup

## Docs

- [DEPLOYMENT.md](DEPLOYMENT.md) — Deploy guide (Vercel + env vars)
- [docs/ENV-SETUP.md](docs/ENV-SETUP.md) — Environment variable setup
- [docs/erd.md](docs/erd.md) — Entity Relationship Diagram
- [docs/SYSTEM.md](docs/SYSTEM.md) — System overview
- [docs/guide/guide.html](docs/guide/guide.html) — User guide for owner + staff (Roman Urdu)
