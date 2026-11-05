# Brovo Bites — design system (v2, Nov 2026)

Single source of truth for the look of the customer website, admin and POS.
Everything comes from the logo (`apps/web/public/logo-full.png`): a red "BB" badge with a
mustard cheese-drip bite, cream chunky lettering with a hard deep-red shadow, on a dark
brown radial background.

## 1. Palette (CSS custom properties in `apps/web/src/app/styles/01-base.css`)

| Token | Hex | Use |
|---|---|---|
| `--bb-brown-950` | `#120906` | footer, deepest edge |
| `--bb-brown-900` | `#190d09` | **dark page background** (logo bg edge), sidebar rail, loader |
| `--bb-brown-850` | `#1f100b` | cards / panels on dark |
| `--bb-brown-800` | `#2a140e` | raised dark surface, radial glow centre (logo bg centre) |
| `--bb-brown-700` | `#3a1e15` | borders / hover on dark |
| `--bb-red-500` | `#d7362b` | **primary** (CTA buttons, active marks on light, the badge) |
| `--bb-red-600` | `#b92b21` | primary hover |
| `--bb-red-700` | `#a3271d` | red **text** on light (6.9:1 on cream) — prices, links, accents |
| `--bb-red-800` | `#882018` | logo lettering shadow, pressed state, sticker shadow |
| `--bb-mustard-500` | `#f0b028` | **accent** on dark (prices, active chip fill, focus ring on dark, drips) |
| `--bb-mustard-400/300` | `#f5c04a` / `#f7cf6e` | mustard hover / highlights |
| `--bb-mustard-700` | `#c58a0e` | mustard borders on light (decorative only) |
| `--bb-cream-50` | `#fffaf3` | **light page background** (admin / POS content) |
| `--bb-cream-100` | `#fff4e8` | logo lettering; text on dark; soft fills on light |
| `--bb-cream-200/300` | `#f8e6d0` / `#efd5b8` | borders, dividers on light |
| `--bb-ink` | `#2a140e` | text on light (16:1) |
| `--bb-muted` | `#7a5a4c` | secondary text on light (≥ 5.9:1) |
| `--bb-muted-on-dark` | `#d4bfae` | secondary text on dark (≥ 9:1) |

Semantic: `--bb-primary` (red-500), `--bb-on-primary` **#fff** (4.7:1), `--bb-accent` (mustard-500),
`--bb-on-accent` brown-900 (10:1). Legacy tokens (`--gold`, `--gold-deep`, `--ink`, `--muted`,
`--border`, `--bg`) were remapped to this palette and stay valid.

**Contrast rules (WCAG AA):** body text ≥ 4.5:1, large text / UI ≥ 3:1.
- Never put mustard text on cream/white (1.8:1). On light, accents are **red-700 text** or mustard **fills** with ink text.
- Red-500 text on brown-900 is only 4.0:1 → use it for large text / icons only; small accent text on dark = mustard or cream.
- Status colours keep their meaning and are NOT brand colours: success green, danger red (`--danger`), warning amber, info sky. A destructive button must still read as destructive (outline or explicit danger style).

## 2. Typography

- **Brand / display:** Lilita One (`var(--font-brand-stack)`, local woff2, Latin only — Urdu falls back to Naskh). Use for: wordmark, landing H1/H2, section titles, menu prices on the website, admin page titles, big KPI numbers on brand cards. Never for body copy, form labels, tables or small UI text.
- **Body / UI:** the system stack already on `<body>` (`var(--font-body)`) — fast, offline-safe, good Urdu fallback.
- Scale: hero H1 `clamp(2.6rem, 1rem + 6vw, 5.5rem)`; section H2 `clamp(1.75rem, 1rem + 2.6vw, 3rem)`; card title 1rem–1.125rem / 600–700; body 1rem; small 0.875rem; never below 12px.
- Logo-style headline on dark: `font-family: var(--font-brand-stack); text-shadow: var(--bb-text-stamp); letter-spacing: 0.01em;` Eyebrows: 0.75rem, 700, uppercase, `letter-spacing: .14em`, mustard on dark / red-700 on light.
- Money and dates keep `dir="ltr"` and `font-variant-numeric: tabular-nums` in data UI.

## 3. Shape, depth, motion

- Radius: cards 18px, inputs/buttons 12–14px, pills 999px, small chips 10px.
- **Sticker button** (primary): red-500 bg, white text, `box-shadow: var(--bb-sticker-shadow)`; hover red-600; active `transform: translateY(2px)` + `0 2px 0` shadow; focus-visible = the standard focus ring (below); disabled = cream-200 bg, muted text, no shadow, `cursor: not-allowed`. Min height 44px.
- **Focus (WCAG 2.4.7 / 1.4.11, ≥ 3:1):** every focusable control gets `outline: 3px solid var(--focus-ring)` with `outline-offset: 2px`. On light, `--focus-ring` is **solid red-700** (7.1:1 on cream-50, 7.3:1 on white). Never use a translucent red ring (red/30–50% is only 1.6–2.2:1). Focused fields (`.input:focus`) instead get a **solid red border** plus a soft halo: a 2px `--field-focus` line (red-500, 4.5:1) drawn inside the box (`outline-offset: -2px`, so overflow-hidden parents cannot clip it) and a 3px `--field-focus-ring` halo (red/28%, decorative). On dark (the dark zones `.admin-filter-panel`, `.modal-dark-head`, `.modal-dark-zone`, plus `html[data-pos-theme="dark"]`) the same tokens switch to **mustard-500**. Field and control borders use `--border-strong` (#a8805f, ≥ 3:1). Do not remove the ring with `outline-none` unless a replacement ring is drawn.
- Secondary: mustard fill + brown-900 text (on dark) / outline ink 1.5px (on light). Ghost on dark: cream text, 1px cream/20% border.
- Cards on dark: brown-850, 1px `--bb-line-on-dark`, hover lift −4px + border mustard/30%. Cards on light: white, 1px cream-300, shadow `0 1px 2px rgba(42,20,14,.06), 0 8px 24px rgba(42,20,14,.06)`.
- Motion: 150–250 ms for hovers, 300–450 ms for reveals, ease `var(--bb-ease-out)`. Animate transform/opacity only. Every animation has a `prefers-reduced-motion: reduce` fallback.
- Brand motifs (use sparingly): the **cheese drip** (mustard SVG drips hanging from an edge) as a section divider; the **bite** (scalloped circle cut-out) as a decorative corner; dark radial glow `radial-gradient(ellipse at 50% 35%, #2a140e 0%, #190d09 60%, #120906 100%)` exactly like the logo background.
- Icons: SVG only (the app already uses inline SVG / lucide-style strokes), consistent 1.75–2px stroke; no emoji as icons.

## 4. Screens

### Customer website (`/` — LandingPage, also the customer-mode domain)
Dark brand experience (brown-900 + radial glow), professional fast-food layout:
1. **Fixed header** (transparent dark gradient over the hero, near-opaque brown-900 once scrolled, no backdrop blur): the **BB badge alone**, with no "BROVO BITES" wordmark next to it (the link keeps the shop name as its accessible label). Then category links (desktop) or a scrollable chip row (below 1200px the header has two rows), the language toggle, and Login/Dashboard only when not in customer mode. **No "Order Now" in the header** (owner request): the WhatsApp CTA lives in the hero only.
2. **Hero** (`LandingHero`, `data-phase` = `intro` → `fade` → `photos`, once per page load):
   - **Intro** (server-rendered, the first paint and the LCP): the big BB badge on the dark logo background (`--landing-glow`) with a soft mustard glow and mustard drops falling from the logo's cheese drip. The badge is `/logo.png`, preloaded with `fetchpriority=high`. Only transform and opacity animate.
   - After about 2s (`HERO_INTRO_MIN_MS`, and only once the first photo has loaded), a 1s **crossfade** into the full-bleed **photo slideshow** (`AtmosphereBg`). The badge and drops fade out.
   - **Slides**: `LANDING_HERO_SLIDES` in `lib/menu-images.ts`, where people slides (`people-N`) and food slides (`hero-N`) alternate. Owner uploads in `settings.heroSlides` win. Art direction uses `<picture>`: phones get the **tall 3:4 crop** (`people-N-tall.jpg`) and desktops the wide 3:2 crop. Photos start loading at about 1.2s, so they never compete with the badge.
   - **Copy anchored bottom-start** at every width, never vertically centred: eyebrow (`settings.eyebrow`), the shop name in Lilita with the stamp shadow, the slogan, then CTAs "View menu" (red sticker) + "Order Now" (WhatsApp, outline, only when a number is set). From 900px the badge sits on the end side during the intro. The scrim darkens from the bottom on phones, and from the start side plus the bottom on desktop (mirrored for RTL, where the photos are flipped too).
   - **Reduced motion**: no falling drops and no Ken Burns zoom. The intro still switches to the photos with a short plain crossfade.
   - A mustard drip edge leads into the next section.
3. **Explore the menu**: category tiles (photo, Lilita name, item count) that jump to sections.
4. **Search** + **menu sections**: category header (round photo, Lilita title, count, drip/underline), item cards (photo 5:4, name, mustard Lilita price badge, size chips, deal lines, strike-through compare price).
5. **Branches & team**, then **footer** (brown-950, full logo, links, copyright, software credit).
Phone first: 2-column item grid on phones, 3 on tablets, 4 on desktop; no horizontal scroll; 44px targets; safe-area insets; RTL mirrored with logical properties.

**Speed (owner: "sab fast load ho")**: never block `/` on a full-screen loader. The header and the hero intro paint from the server HTML, and only the menu area shows skeletons until data arrives. The public page loads no Firebase Auth or Firestore: the menu comes from the cached `/api/public/menu` route. Lilita is the only font on English pages (the Naskh font loads for Urdu only). Every image below the hero is lazy.

### Login (+ BranchGate, same markup)
Dark atmosphere (hero photos) with a centred card; the card can be cream (light form, high legibility) on the dark page. Inputs ≥ 16px font.

### Admin
Brown-900 sidebar rail (mustard active marker, cream text, red "Open POS" sticker), cream-50 content. Dashboard hero = brand card (dark radial + Lilita title + mustard business-day pill); KPI cards white with ink numbers; the primary "Today's sales" card is the red brand card. Charts in mustard → mustard-700 gradient; tooltips brown-900/cream.

### POS
Light: cream-50 background, white product cards, red-700 prices, red round "+" buttons, active category = brown-900 card with mustard text. Dark (`html[data-pos-theme="dark"]`): the brown ladder, mustard accents. Fast and dense — no decorative motion.

### Loader
`LogoLoader`: dark radial logo background, the BB badge with a rotating mustard arc, gentle bite bounce, falling mustard drips, "BROVO BITES" wordmark, i18n label; `role="status"`, reduced-motion = static.

## 5. Photos
Bundled photos live in `apps/web/public/menu/brovo/` and are mapped by item name in
`apps/web/src/lib/menu-images.ts` (see `docs/MENU-PHOTOS.md`). Owner uploads (ImageKit) always win.
