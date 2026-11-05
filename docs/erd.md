# Brovo Bites POS — ERD

## Entity relationship

```mermaid
erDiagram
  BRANCHES ||--o{ ORDERS : has
  CATEGORIES ||--o{ PRODUCTS : contains
  USERS ||--o{ ORDERS : creates
  COUNTERS ||--o{ ORDERS : numbers
  SETTINGS ||--|| SHOP : configures

  BRANCHES {
    string id PK
    string name
    string phone
    string address
    boolean isActive
    string createdAt
  }

  USERS {
    string uid PK
    string email
    string displayName
    string role
    string branchIds
    boolean isActive
    string createdAt
  }

  CATEGORIES {
    string id PK
    string branchId FK
    string name
    number sortOrder
    boolean isActive
  }

  PRODUCTS {
    string id PK
    string branchId FK
    string categoryId FK
    string name
    string type
    number basePrice
    array variations
    array dealItems
    boolean isActive
    number sortOrder
  }

  ORDERS {
    string id PK
    string branchId FK
    number orderNumber
    array items
    number subtotal
    number total
    string paymentMethod
    string status
    string createdBy FK
    string createdByName
    string createdAt
  }

  COUNTERS {
    string id PK "global"
    number lastOrderNumber
  }

  SETTINGS {
    string id PK
    string shopName
    string phone
    string currency
    string slogan
  }
```

## Product types

- **simple** — single `basePrice` (burgers, drinks)
- **sized** — `variations[]` with label + price (pizza S/M/L/XL, fries)
- **bundle** — deal `basePrice` + `dealItems[]` labels for kitchen

## Multi-branch

New shop = new `branches` doc. The menu (categories + products) is shared by all branches — their `branchId` is the legacy value `"shared"`.  
Orders, expenses, inventory and cash drawers are scoped by the real `branchId`.  
Order numbers come from one global counter (`counters/global`), shared by all branches.  
Counter users get `branchIds: [thatBranch]`. Owner sees all.
