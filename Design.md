# Design — Habitt

Direction: quiet, editorial, garment-industry-literate minimalism (Rare Rabbit-adjacent) — not the generic AI-cream-and-terracotta look. Signature motif: garment "care label" tags (monospace, bordered) on products, and a subtle diagonal fold-crease line used in hero/section breaks, evoking a folded shirt placket. Everything in this file applies to **both** the storefront and the admin, with the admin sections below adding the responsive operating patterns.

## Color tokens
| Token | Hex | Use |
|---|---|---|
| Paper | `#F5F2EC` | page background |
| Card | `#FBF9F5` | product cards, panels |
| Ink | `#1D1B18` | primary text, primary buttons |
| Moss | `#545A3E` | accent — cart dot, success states, admin add-button, "saved" states |
| Clay | `#A8492F` | sparing use — low-stock warnings, delete actions, errors |
| Stone | `#DAD3C4` | borders, dividers |
| Stone Dark | `#B7AF9C` | secondary text, disabled states |
| Pay Navy | `#072654` | the payment button only |

Contrast: body text on Paper and Card must meet WCAG AA. Stone Dark is for secondary and disabled text only, never for essential information on a small size. Status is never conveyed by color alone (always a label).

## Typography
- **Display**: Fraunces (serif, italic for hero headline, weight 500–600) — H1/H2 only, used sparingly.
- **Body**: Inter (400/500) — everything else.
- **Utility/mono**: JetBrains Mono (400/500, small, letter-spacing 0.06–0.12em) — prices, order ids, category tags, care labels, status chips.
- `text-wrap: balance` on all headings and hero lines; `text-wrap: pretty` on descriptions and policy copy.
- `font-variant-numeric: tabular-nums` on every price, quantity, total, table number and metric, including in Inter.
- Minimum body size 16px on inputs (prevents mobile zoom); nav text may stay small and lowercase.

## Layout
- Max content width ~1100–1200px on desktop, single column on mobile. Design at **375px first**.
- Product grid: `repeat(auto-fill, minmax(220px, 1fr))`, gaps 20–24px; two columns on phones.
- **No rounded corners anywhere** (radius 0): product cards, buttons, inputs, sheets, filter pills, chips. Sharp edges = fabric and paper, not "app". Any existing rounded pill (for example shop category filters) is converted to a sharp bordered tag.
- Hairline 1px Stone borders instead of shadows. The only allowed elevation is a 1px border plus a scrim behind sheets and drawers.
- Cart and filters are slide-overs/sheets (keeps browsing momentum). Checkout is a dedicated page (trust over momentum).
- Safe areas: the app declares `viewport-fit=cover`; sticky headers, drawer footers, bottom bars and the admin tab bar add `env(safe-area-inset-*)` padding.
- Touch targets are at least **44×44px**, including icon buttons (qty steppers, remove, close). Small visuals get invisible hit padding ("hit slop") rather than bigger icons.
- Thumb zone: primary actions on mobile sit in the lower half or in a sticky bottom bar.

## Header
Three-column grid: left nav (`shop` / `journal` / `about`), centered small line-icon + lowercase wordmark (`habitt`), right nav (`search` / `wishlist` / `admin` *(staff only, Moss)* / `account` / `cart`). All lowercase, ~12.5px, slight letter-spacing, no bold. Cart shows a small solid dot when non-empty. An optional announcement bar (Ink on Paper, mono, 12px) sits above and can be dismissed for the session. On mobile the nav collapses into a menu sheet; the wordmark stays centered.

## Core components
- **Primary button:** Ink background, Paper text, no radius, letter-spacing, all-caps for short CTAs ("ADD TO BAG", "CHECKOUT"). Secondary: Ink 1px border on Paper. Destructive: Clay border and text, filled only in a confirmation step.
- **Pay button:** Pay Navy, signals the handoff to the payment processor. The COD "PLACE ORDER" button is Ink.
- **Care tag:** bordered box, mono, uppercase — fabric/colorway tags on the storefront, status chips in admin.
- **Inputs:** visible labels above fields (placeholders are hints only), correct `type`/`inputMode`/`autocomplete`, inline error text in Clay with an icon-free label, 44px minimum height.
- **Price display:** selling price in mono; compare-at price struck through in Stone Dark; savings shown as a care tag ("SAVE ₹498"). "Was" prices must be genuine.
- **Skeletons:** Card-coloured blocks with a slow, subtle opacity shimmer matching the final layout (grid, product page, tables, order list). No spinners for page-level loading.
- **Toasts:** bottom-center on mobile, Ink on Paper, hairline border, 5-second timeout, optional **Undo** action (cart remove, archive, deletes). Never stack more than two.
- **Empty states:** a short sentence in Fraunces italic and one clear action.

## Storefront patterns
- **Product card:** 4:5 image with a blur placeholder, name (Inter), price (mono), optional care tag for sale/combo/new. Wishlist heart top-right with a 44px hit area.
- **Product page:** swipeable gallery with zoom and thumbnails; color swatches (square, hairline border); size chips (sharp, strikethrough when sold out); sticky mobile **ADD TO BAG** bar above the safe area; collapsible fabric/care/size-chart/FAQ; "complete the look" row; verified-buyer reviews; "Share on WhatsApp" and pincode checker near the buy box.
- **Size recommender:** small sheet with height and weight inputs and a plain result ("We suggest M — model is 5'10" wearing M").
- **Cart drawer:** line items with thumbnails; an itemised savings block (sale, each offer, coupon, prepaid note); a progress line toward free shipping; combo nudge text in a care tag. The drawer stays mounted and animates with a CSS transform (interruptible), closes on swipe-right, on scrim tap, and on the Android back gesture/button.
- **Offer messages:** the coupon-versus-automatic comparison appears as a calm inline note under the coupon field, never a modal.
- **Sign-in sheet (OTP):** bottom sheet on mobile, centered dialog on desktop. Step 1: phone input (country code +91 preselected) with "Use email instead" link. Step 2: six separate digit boxes that accept paste and auto-submit, a 30-second resend timer, and a "send to email instead" fallback if WhatsApp fails. Copy explains why we ask ("to keep your order safe"). The sheet is swipe-to-dismiss and keeps the cart visible behind it.
- **Checkout:** four labelled steps on one page with a persistent order summary (collapsed on mobile); payment options as large selectable rows with the online option showing the saving; the COD fee appears on its row, not at the end.
- **Order timeline:** vertical list of stages with timestamps in mono; the current stage in Moss; courier and AWB as a care tag with a "Track" link.
- **Wallet:** balance, entries with expiry dates, "redeem gift card" field; credit amounts in Moss.
- **Consent banner:** bottom sheet on first visit; three clear choices (Essential only / Customise / Accept all); no dark patterns, equal visual weight for accept and reject. A preferences page repeats the same controls.
- **Footer:** legal name, address, GSTIN, grievance officer and contact, policy links, social links, owner-editable.

## Motion
- Minimal and **interruptible**: transitions use CSS transitions on transform/opacity (never keyframes that can't reverse), so tapping again mid-animation reverses smoothly. Drawer/sheet 200ms ease; hover = opacity/border shift only.
- Optional progressive enhancement: View Transitions for product card → product page image; if unsupported or reduced motion is on, navigation is instant.
- Respect `prefers-reduced-motion`: remove transforms, keep opacity fades under 100ms.
- No scroll-triggered animation.

## Admin design system (phone and desktop)
The admin uses the same tokens, sharp corners and mono details, with density and ergonomics tuned for operating a business.

- **Shell:** at ≥1024px a left sidebar (collapsible) with sections; below 1024px a **bottom tab bar** — Dashboard, Orders, Products, More — padded for the safe area, with "More" opening a full-height sheet of the remaining sections. A top bar shows the page title, search, and the owner's name.
- **List pattern:** one data layer, two presentations. **Phones:** each row becomes a card (e.g. an order card shows id, customer, total, a status care tag and two quick actions). **Desktop:** dense tables with hairline row dividers, sortable columns, sticky headers, pagination and saved views; no zebra striping.
- **Actions:** on phones, status changes, filters and bulk actions open as **bottom sheets** (swipe to dismiss); on desktop they are inline menus and side panels. Primary page action is a sticky bottom bar on phones.
- **Forms:** single column on phones, two columns at ≥1024px; sticky Save bar showing unsaved-changes state; numeric fields use `inputMode="numeric"/"decimal"`; money fields show ₹ and convert to paise; destructive actions need confirmation and (for sensitive ones) a fresh code.
- **Dashboard:** "Needs attention" list first, then KPI cards in a horizontally scrollable row on phones (grid on desktop), then charts. Date-range chips (Today, 7d, 30d, Custom). Charts are simple, labelled, tabular-numeral axes; every chart has a table fallback.
- **Status care tags:** payment status and fulfilment status use separate tags so "PAID · SHIPPED" or "COD PENDING · CONFIRMED" reads at a glance.
- **Builders:** the offer builder is a stepped form (type → targets → rules → schedule → review) with a live "test this cart" simulator panel; the content editor shows a live preview with a "preview as customer" toggle and a schedule control.
- **Product photos:** camera/gallery upload, in-browser compression before upload, drag-to-reorder on desktop and move up/down buttons on phones, a visible upload progress state.
- **Command menu (desktop only):** ⌘K / Ctrl+K opens a jump-to palette (orders by id, products, settings) with visible shortcut hints. Not shown on phones.
- **PWA:** installable manifest (name, Paper/Ink theme colors, maskable icons), standalone display for `/admin`, push permission requested only after the owner opts in.
- **Optimistic updates:** stock edits and status changes update instantly and roll back with an error toast on failure; archives show an Undo toast.

## Accessibility and quality bar
- Every interactive element is keyboard reachable with a visible 2px Ink focus ring (offset 2px). Sheets and dialogs trap focus and restore it on close; Escape closes them.
- Labels on all inputs; error messages tied with `aria-describedby`; toasts announced politely; drawers and sheets have accessible names.
- Images always have alt text (product name + color). Decorative motifs are `aria-hidden`.
- Performance budgets: LCP < 2.5s on a mid-range phone over 4G, CLS < 0.1, INP < 200ms; product images use responsive sizes and blur placeholders; third-party scripts load after consent and after first paint.

## Content tone
Short, calm, specific. Lowercase navigation, sentence-case body, uppercase only for short CTAs. No countdown timers or fake scarcity. Prices always tax-inclusive with a "Inclusive of all taxes" note near the total.

## Reference implementation
`habitt_prototype.jsx` (kept alongside these docs) holds the original tokens and components as a working mock and remains the visual source of truth for the storefront. **Before building each milestone's UI, sketch or extend the prototype for the new screens:** the OTP sheet, the cart with the offer breakdown, the mobile product page with the sticky bar, the checkout payment step with COD, the order timeline, the admin dashboard and order detail on a phone, the offer builder, and the consent banner.
