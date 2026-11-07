# Menu photos — how they work and how to replace them

## Where photos come from (in this order)

1. **Owner upload** — Admin → Menu → edit item/category → upload a photo. Stored on ImageKit. Always wins.
2. **Bundled photo** — files in `apps/web/public/menu/brovo/` mapped by name in
   `apps/web/src/lib/menu-images.ts`. Used when nothing was uploaded.
3. **Logo** — only for a brand-new item whose name matches nothing.

Bundled photos belong to the code, not the database: replacing a file (same name) or changing
the mapping and then running `pnpm ship:dev` / `pnpm ship:live` is enough — no Firestore edit.
Credits / licences: `apps/web/public/menu/brovo/CREDITS.md`.

## Replace a bundled photo yourself (e.g. with an AI image from Gemini / ChatGPT)

1. Generate the image with the prompt below (or take a real photo of your own food — best of all).
2. Crop to the size in the table (items **800×640**, categories **600×600**, hero **2400×1600**), save as **JPG**.
3. Save it over the file with **exactly the same name** in `apps/web/public/menu/brovo/…`.
4. Check locally (`pnpm --filter web dev` → http://localhost:3001), then `pnpm ship:dev`.

**Style line to add to every prompt** (keeps all photos matching the dark-brown Brovo Bites theme):

> Professional food photography for a Pakistani fast-food restaurant menu, real and appetizing,
> dark brown wooden table, warm side light, shallow depth of field, subject centered, no text,
> no logos, no packaging brand names, halal (no pork, no alcohol), 5:4 landscape.

| File (`apps/web/public/menu/brovo/…`) | Menu item | Prompt (+ style line) |
|---|---|---|
| `items/zinger-burger.jpg` | Zinger Burger | Crispy crunchy fried chicken zinger burger, thick golden fillet, lettuce and mayo, soft sesame bun |
| `items/patty-burger.jpg` | Patty Burger | Simple chicken patty burger, round breaded patty, lettuce, ketchup-mayo sauce |
| `items/beef-burger.jpg` | Beef Burger | Juicy grilled beef patty burger with cheese slice, lettuce, tomato, onion |
| `items/beef-double-patty.jpg` | Beef Double Patty | Tall burger with two beef patties and melted cheddar dripping |
| `items/grilled-wrap.jpg` | Grilled Wrap | Grilled chicken tortilla wrap with grill marks, cut in half showing chicken, veg and garlic sauce |
| `items/wings.jpg` | Wings (6 pcs) | Six crispy golden fried chicken wings |
| `items/bbq-wings.jpg` | BBQ Wings (6 pcs) | Six chicken wings glazed in sticky dark BBQ sauce, sesame and spring onion |
| `items/buffalo-wings.jpg` | Buffalo Wings (6 pcs) | Six orange-red buffalo hot wings with a small ranch dip |
| `items/nuggets.jpg` | Nuggets (6 pcs) | Six golden chicken nuggets with a small dip |
| `items/injected-nuggets.jpg` | Injected Nuggets (6 pcs) | Cheese-injected chicken nuggets, one broken open with molten cheese pull |
| `items/large-fries.jpg` | Large Fries | Large portion of golden french fries in a plain paper box |
| `items/loaded-fries.jpg` | Loaded Fries (Large) | Fries loaded with cheese sauce, crispy chicken chunks, jalapeños, garlic mayo drizzle |
| `items/fries-bucket.jpg` | Fries Bucket | A big plain bucket heaped with golden fries |
| `items/russian-salad.jpg` | Russian Salad | Pakistani creamy Russian salad, diced potato, apple, peas, carrot, cream dressing |
| `items/apple-cabbage-salad.jpg` | Apple Cabbage Salad | Creamy coleslaw with shredded cabbage, carrot and apple pieces |
| `items/macaroni-salad.jpg` | Macaroni Salad | Creamy elbow macaroni salad with diced vegetables |
| `items/dip-smoky-bbq.jpg` | Smoky BBQ Dip | Small ramekin of dark smoky BBQ sauce |
| `items/dip-creamy-ranch.jpg` | Creamy Ranch Dip | Small ramekin of white ranch dip with herbs |
| `items/dip-spicy-mayo.jpg` | Spicy Mayo Dip | Small ramekin of orange spicy mayo |
| `items/dip-chilli-garlic.jpg` | Chilli Garlic Dip | Small ramekin of red chunky chilli garlic sauce |
| `items/dip-creamy-garlic.jpg` | Creamy Garlic Dip | Small ramekin of creamy garlic mayo with garlic cloves |
| `items/dip-spicy-buffalo.jpg` | Spicy Buffalo Dip | Small ramekin of orange buffalo hot sauce |
| `items/extra-cheese.jpg` | Extra Cheese | Cheddar cheese slices, melted cheese |
| `items/masala-sprinkle.jpg` | Masala Sprinkle | Red chaat masala spice powder sprinkled over fries |
| `items/cola-next.jpg` | Cola Next 350ml | Chilled 345 ml Pakistani cola glass bottle with condensation and ice (use a real Cola Next photo if you have one) |
| `items/fizzup.jpg` | Fizzup 350ml | Chilled clear lemon-lime soda bottle with lemon slices and ice (use a real Fizzup photo if you have one) |
| `categories/burgers-wraps.jpg` | Category | Burgers and a wrap together, square 1:1 |
| `categories/wings-nuggets.jpg` | Category | Wings and nuggets platter, square 1:1 |
| `categories/fries.jpg` | Category | Fries close-up, square 1:1 |
| `categories/salads.jpg` | Category | Creamy salads in bowls, square 1:1 |
| `categories/dip-sauces.jpg` | Category | Several dip sauces in ramekins, square 1:1 |
| `categories/extras.jpg` | Category | Cheese and spice toppings, square 1:1 |
| `categories/drinks.jpg` | Category | Cold soft drinks with ice, square 1:1 |
| `hero/people-1-wide.jpg`, `hero/scene-1-wide.jpg` … `scene-5-wide.jpg` (+ `-tall`) | Landing hero | Wide 3:2 shots filling the frame edge to edge: a person and scenes, not menu items. The copy sits lower left under a light overlay. Plus a 3:4 `-tall` crop for phones and portrait tablets |
| `hero/hero-1.jpg` … `hero/hero-4.jpg` (+ `-tall`) | Login and branch picker backdrop | Wide 3:2 shots of the menu's food, plus a 3:4 `-tall` crop |
