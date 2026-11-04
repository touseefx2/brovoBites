#!/usr/bin/env bash
# Unique HD menu photos → public/menu/{categories,items}
# Category 400×400 | Product 800×640
# Source: Unsplash (verified photo IDs only)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CAT_DIR="$ROOT/public/menu/categories"
ITEM_DIR="$ROOT/public/menu/items"
mkdir -p "$CAT_DIR" "$ITEM_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() {
  local id="$1" out="$2" w="$3" h="$4"
  local raw="$TMP/$(basename "$out").jpg"
  local url="https://images.unsplash.com/${id}?w=$((w * 2))&h=$((h * 2))&fit=crop&q=85"
  echo "→ $(basename "$out")"
  curl -fsSL -L -A "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36" \
    --retry 4 --retry-delay 2 --max-time 60 -o "$raw" "$url"
  sips -z "$h" "$w" "$raw" --out "$out" >/dev/null 2>&1
  local bytes
  bytes=$(wc -c < "$out" | tr -d ' ')
  if [[ "$bytes" -lt 8000 ]]; then
    echo "   FAIL small file ($bytes bytes): $out" >&2
    exit 1
  fi
}

# ── Categories (400×400) ──
fetch "photo-1604503468506-a8da13d82791" "$CAT_DIR/sajji-rice.jpg" 400 400
fetch "photo-1565299624946-b28f40a0ae38" "$CAT_DIR/pizza.jpg" 400 400
fetch "photo-1553909489-cd47e0907980" "$CAT_DIR/sandwiches.jpg" 400 400
fetch "photo-1550547660-d9450f859349" "$CAT_DIR/burgers.jpg" 400 400
fetch "photo-1541529086526-db283c563270" "$CAT_DIR/spring-rolls.jpg" 400 400
fetch "photo-1621996346565-e3dbc646d9a9" "$CAT_DIR/pasta.jpg" 400 400
fetch "photo-1573080496219-bb080dd4f877" "$CAT_DIR/sides.jpg" 400 400
fetch "photo-1629203851122-3726ecdf080e" "$CAT_DIR/beverages.jpg" 400 400
fetch "photo-1594212699903-ec8a3eca50f5" "$CAT_DIR/combo-deals.jpg" 400 400

# ── Sajji ──
fetch "photo-1604503468506-a8da13d82791" "$ITEM_DIR/sajji-with-rice.jpg" 800 640
fetch "photo-1604908176997-125f25cc6f3d" "$ITEM_DIR/sajji-without-rice.jpg" 800 640
fetch "photo-1536304993881-ff6e9eefa2a6" "$ITEM_DIR/only-rice.jpg" 800 640

# ── Pizza (10 unique) ──
fetch "photo-1565299624946-b28f40a0ae38" "$ITEM_DIR/chicken-tikka-pizza.jpg" 800 640
fetch "photo-1574071318508-1cdbab80d002" "$ITEM_DIR/chicken-fajita-pizza.jpg" 800 640
fetch "photo-1593560708920-61dd98c46a4e" "$ITEM_DIR/chicken-hot-spicy-pizza.jpg" 800 640
fetch "photo-1604382354936-07c5d9983bd3" "$ITEM_DIR/chicken-supreme-pizza.jpg" 800 640
fetch "photo-1594007654729-407eedc4be65" "$ITEM_DIR/bihari-kebab-pizza.jpg" 800 640
fetch "photo-1588315029754-2dd089d39a1a" "$ITEM_DIR/kebab-stuffed-pizza.jpg" 800 640
fetch "photo-1565299507177-b0ac66763828" "$ITEM_DIR/vegetable-pizza.jpg" 800 640
fetch "photo-1476224203421-9ac39bcb3327" "$ITEM_DIR/crown-crust-pizza.jpg" 800 640
fetch "photo-1516684669134-de6f7c473a2a" "$ITEM_DIR/special-sd-pizza.jpg" 800 640
fetch "photo-1555939594-58d7cb561ad1" "$ITEM_DIR/bbq-pizza.jpg" 800 640

# ── Sandwiches ──
fetch "photo-1553909489-cd47e0907980" "$ITEM_DIR/chicken-club.jpg" 800 640
fetch "photo-1526318472351-c75fcf070305" "$ITEM_DIR/mexican-sandwich.jpg" 800 640
fetch "photo-1482049016688-2d3e1b311543" "$ITEM_DIR/special-sandwich.jpg" 800 640

# ── Burgers ──
fetch "photo-1606755962773-d324e0a13086" "$ITEM_DIR/classic-zinger.jpg" 800 640
fetch "photo-1571091718767-18b5b1457add" "$ITEM_DIR/cheese-zinger.jpg" 800 640
fetch "photo-1553979459-d2229ba7433b" "$ITEM_DIR/double-zinger.jpg" 800 640
fetch "photo-1586190848861-99aa4a171e90" "$ITEM_DIR/double-zinger-cheese.jpg" 800 640

# ── Spring rolls ──
fetch "photo-1541529086526-db283c563270" "$ITEM_DIR/chicken-tikka-spring-roll.jpg" 800 640
fetch "photo-1617196034796-73dfa7b1fd56" "$ITEM_DIR/kebab-spring-roll.jpg" 800 640
fetch "photo-1585238342024-78d387f4a707" "$ITEM_DIR/special-spring-roll.jpg" 800 640

# ── Pasta ──
fetch "photo-1621996346565-e3dbc646d9a9" "$ITEM_DIR/crunchy-pasta.jpg" 800 640
fetch "photo-1473093295043-cdd812d0e601" "$ITEM_DIR/sdf-special-pasta.jpg" 800 640

# ── Sides ──
fetch "photo-1562967916-eb82221dfb92" "$ITEM_DIR/nuggets.jpg" 800 640
fetch "photo-1573080496219-bb080dd4f877" "$ITEM_DIR/fries.jpg" 800 640
fetch "photo-1630383249896-424e482df921" "$ITEM_DIR/loaded-fries.jpg" 800 640
fetch "photo-1626082927389-6cd097cdc6ec" "$ITEM_DIR/fried-wings.jpg" 800 640
fetch "photo-1626645738196-c2a7c87a8f58" "$ITEM_DIR/chicken-tempura.jpg" 800 640

# ── Beverages ──
fetch "photo-1629203851122-3726ecdf080e" "$ITEM_DIR/soft-drink.jpg" 800 640
fetch "photo-1544145945-f90425340c7e" "$ITEM_DIR/mineral-water.jpg" 800 640
fetch "photo-1556679343-c7306c1976bc" "$ITEM_DIR/mint-margarita.jpg" 800 640
fetch "photo-1600275669439-14e40452d20b" "$ITEM_DIR/extra-mayo.jpg" 800 640

# ── Deals (unique feast / meal shots) ──
fetch "photo-1551782450-a2132b4ba21d" "$ITEM_DIR/solo-zinger-deal.jpg" 800 640
fetch "photo-1572802419224-296b0aeee0d9" "$ITEM_DIR/solo-pizza-deal.jpg" 800 640
fetch "photo-1467003909585-2f8a72700288" "$ITEM_DIR/solo-sandwich-deal.jpg" 800 640
fetch "photo-1599487488170-d11ec9c172f0" "$ITEM_DIR/duo-zinger-deal.jpg" 800 640
fetch "photo-1432139555190-58524dae6a55" "$ITEM_DIR/duo-pizza-deal.jpg" 800 640
fetch "photo-1504674900247-0877df9cc836" "$ITEM_DIR/trio-wings-rolls-deal.jpg" 800 640
fetch "photo-1414235077428-338989a2e8c0" "$ITEM_DIR/small-family-deal.jpg" 800 640
fetch "photo-1540189549336-e6e99c3679fe" "$ITEM_DIR/medium-family-deal.jpg" 800 640
fetch "photo-1490645935967-10de6ba17061" "$ITEM_DIR/large-family-deal.jpg" 800 640
fetch "photo-1546069901-ba9599a7e63c" "$ITEM_DIR/mega-family-deal.jpg" 800 640

echo ""
echo "DONE categories=$(ls "$CAT_DIR" | wc -l | tr -d ' ') items=$(ls "$ITEM_DIR" | wc -l | tr -d ' ')"
