# Design — Habitt

Direction: quiet, editorial, garment-industry-literate minimalism (Rare Rabbit-adjacent) —
not the generic AI-cream-and-terracotta look. Signature motif: garment "care label" tags
(monospace, bordered) on products, and a subtle diagonal fold-crease line used in hero/section
breaks, evoking a folded shirt placket.

## Color tokens
| Token | Hex | Use |
|---|---|---|
| Paper | `#F5F2EC` | page background |
| Card | `#FBF9F5` | product cards, panels |
| Ink | `#1D1B18` | primary text, primary buttons |
| Moss | `#545A3E` | accent — cart badge, success states, admin add-button |
| Clay | `#A8492F` | sparing use — low-stock warnings, delete actions |
| Stone | `#DAD3C4` | borders, dividers |
| Stone Dark | `#B7AF9C` | secondary text, disabled states |

## Typography
- **Display**: Fraunces (serif, italic for hero headline, weight 500–600) — editorial warmth, used sparingly for H1/H2 only.
- **Body**: Inter (400/500) — everything else, product names, UI copy.
- **Utility/mono**: JetBrains Mono (400/500, small size, letter-spacing 0.06–0.12em) — prices, order IDs, category tags, care labels. This is the "garment tag" signature detail.

## Layout
- Max content width ~1100–1200px on desktop, single column on mobile.
- Product grid: `repeat(auto-fill, minmax(220px, 1fr))`, generous gaps (20–24px), no rounded corners on product cards (sharp edges = fabric/paper, not "app").
- Cart and product detail as slide-over drawers, not full page navigation — keeps browsing momentum.
- Checkout is a dedicated page (trust matters more than momentum at that step).
- Hairline 1px borders (Stone) throughout instead of shadows/elevation — flat, print-like.

## Header
Three-column grid, not the usual left-logo layout: left nav (`shop` / `journal` / `about`),
a centered small line-icon + lowercase wordmark (`habitt`) linking home, right nav
(`search` / `admin` *(staff only)* / `account` / `cart`). All nav text lowercase, ~12.5px,
slight letter-spacing, no bold — restraint here is what makes the centered wordmark read as
the one deliberate moment. Cart shows a small solid dot (not a numeric badge) when non-empty,
matching the reference's understated "cart •" treatment rather than a loud counter pill.
`admin` renders in Moss to visually separate it from the rest of the nav when a staff member
is signed in — it's the only nav item that isn't always present, so it earns a distinct color.

## Components (buttons, forms, tags)
- Primary button: Ink background, Paper text, no radius, letter-spacing on label, all-caps for short CTAs ("ADD TO BAG", "CHECKOUT").
- Pay button: distinct dark navy (`#072654`, close to Razorpay's own brand navy) so the payment step visually reads as "handing off to a payment processor."
- Care tags: bordered box, mono font, uppercase, used for both fabric/colorway tags on the storefront and status pills in admin.
- Admin tables: dense, hairline row dividers, no zebra striping — data-table feel, not consumer app feel.

## Motion
- Minimal: drawer slide-in/out (200ms ease), button hover = slight opacity/border shift only, no scroll-triggered animation needed for MVP. Respect `prefers-reduced-motion`.

## Reference implementation
See `habitt_prototype.jsx` (shared alongside these docs) for the tokens and components above
implemented as a working mock — use it as the visual source of truth when building the real
frontend, swapping mock state for real API calls.
