# Performance workspace design QA

- Source visual truth: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/qa/team-performance-approved-layout-1920.png`
- Implementation detail screenshot: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/qa/performance-integration-final/01-performance-detail-desktop.png`
- Mobile Dialog screenshot: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/qa/performance-integration-final/02-member-wage-dialog-430.png`
- Rules screenshot: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/qa/performance-integration-final/03-performance-rules-desktop.png`
- Full comparison: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/qa/performance-integration-final/compare-source-vs-final.png`
- Focused comparison: `/Volumes/公司文件/Whole Hearted Car Service 综合管理系统_协作开发/qa/performance-integration-final/compare-focused-detail.png`
- Viewports: detail/rules `1920 x 1000`; wage Dialog `430 x 932`.
- Pixel density: source and implementation were captured at deviceScaleFactor `1`; the full comparison crops the source to `1920 x 1000` and places it beside the `1920 x 1000` implementation without density scaling. The focused comparison uses equal-height `1880 x 880` content crops.
- State: source is `车间一组 / 2026年7月 / 已锁定`; final primary capture is the product-required default `车间一组 / 2026年8月 / 正在归集`. The state difference is intentional and was not treated as visual drift.

## Full-view comparison

The page keeps the approved hierarchy: context/header, month controls, four overview cards, a large trend section, then the member payroll table. The final application includes the existing `220px` product sidebar, the required four-team switcher, and the new rule summary/entry; these are intentional product additions. Main-region proportions, density, borders, radii, and above-the-fold rhythm remain consistent with the approved layout.

## Focused comparison

The focused side-by-side comparison verifies the overview cards, segmented metric controls, chart grid/bars/average line, status treatment, and table header. The source shows eight illustrative months while the implementation shows the required twelve locked months plus the collecting month; the denser series is a data requirement, not a layout regression. Current collecting data is rendered with a faint dashed bar and no final rise/fall conclusion.

## Required fidelity surfaces

- Fonts and typography: existing system sans stack is retained. Headings, metric values, table text, helper copy, and tabular numerals preserve the approved hierarchy and remain readable at both tested viewports.
- Spacing and layout rhythm: section spacing, card padding, radii, subtle elevation, and four-card alignment match the source direction. The 430px page and Dialog have no document horizontal overflow; only intended internal content scrolls.
- Colors and visual tokens: existing primary blue, success green, muted slate, borders, and card surfaces are reused. Collecting and locked states are visually distinct without introducing a new palette.
- Image and asset fidelity: the existing product logo asset is retained and remains sharp. No visible logo, icon, or product asset was replaced with emoji, CSS art, or a placeholder.
- Copy and content: team target, actual performance, shared completion, payroll, historical comparison, salary preview, and rule formulas use the approved business language. No management-system signature or confidentiality prompt appears.

## Interaction and runtime evidence

- Four team routes, current/previous/history months, three trend metrics, history rows, member details, salary preview/save/failure recovery, read-only/locked states, rule preview/schedule/history, keyboard focus trapping, and return navigation were exercised by browser tests.
- Final integrated results: detail `19/19`, rules `4/4`, dashboard `7/7`, unit `47/47`, collaboration `2/2`, typecheck and build passed.
- All three final browser captures recorded HTTP success, console errors `0`, page errors `0`, framework overlays `0`, and document horizontal overflow `0`.

## Findings and comparison history

- Earlier mobile evidence exposed root `scrollWidth = 912` because table content contributed to document width. The table boundary was corrected; the revised 430px evidence measures root width `430` with only internal table scrolling.
- No actionable P0, P1, or P2 mismatch remains in the revised implementation.
- Follow-up P3 only: the build retains two non-failing pre-existing warnings concerning `aria-selected` semantics and Logo `<img>` optimization. They do not affect the validated performance workflows or visual fidelity.

final result: passed

---

# Inspection, billing, and clean-money acceptance — 2026-08-23

## Accepted runtime and data scope

- Runtime: `http://127.0.0.1:3210`, one reused development server.
- Current Mock business data is a clean five-order demonstration set: `demo-v2-provisional`, `demo-v2-partial`, `demo-v2-refunds`, `demo-v2-parking`, and `demo-v2-parking-unclaimed`.
- No historical Mock migration, backfill, cutover, recovery, or dual-write path is part of this acceptance. Resetting the project business storage rebuilds this current-contract seed through the same Invoice, payment, refund, pickup, parking-claim, and parking-correction producers used by the application.
- Primary URLs opened and exercised: `/orders/inspections`, `/orders/business`, `/payments`, `/parking`, and `/orders/business/demo-v2-refunds`.

## Independent money facts observed

The Payments workspace shows eight independent rows: five payments and three refunds. Each row has its own ID, amount, method, committed time, owner, and source; no order-level embedded payment/refund history is used as the authority.

- `demo-v2-partial-payment-1`: JMD 4,000, cash.
- `demo-v2-partial-payment-2`: JMD 3,500, card.
- `demo-v2-refunds-payment-1`: JMD 13,000, cash.
- `demo-v2-parking-claim-payment-1`: parking-owned card payment.
- `demo-v2-parking-invoice-balance-payment-1`: separate card payment for the remaining Invoice balance.
- `demo-v2-refunds-refund-1`: JMD 8,000 receivable reduction, JMD 0 cash returned.
- `demo-v2-refunds-refund-2`: JMD 5,000 receivable reduction, JMD 5,000 cash returned.
- `demo-v2-parking-correction-apply-1`: JMD 2,500 parking correction returned by card.

The refund demonstration order remains on formal Invoice V2 while its V1 immutable document and V1 payment/refund lineage remain readable. The parking workspace separately shows one claimed source and one unclaimed source; the one-day correction remains its own parking-owned refund fact.

## Browser and responsive evidence

Exact Playwright captures were taken at device scale `1`. Every exact-size capture reported `innerWidth` equal to the requested viewport, root `scrollWidth === clientWidth`, and no Next.js error portal.

| Surface | 1470×874 | 430×932 |
| --- | --- | --- |
| Inspection Report | `docs/screenshots/task8-clean-ir-1470-20260823.png` | `docs/screenshots/task8-clean-ir-430-20260823.png` |
| Business Orders | `docs/screenshots/task8-clean-bo-1470-20260823.png` | `docs/screenshots/task8-clean-bo-430-20260823.png` |
| Payments | `docs/screenshots/task8-clean-payments-1470-20260823.png` | `docs/screenshots/task8-clean-payments-430-20260823.png` |
| Parking | `docs/screenshots/task8-clean-parking-1470-20260823.png` | `docs/screenshots/task8-clean-parking-430-20260823.png` |
| Invoice / statement | `docs/screenshots/task8-clean-invoice-1470-20260823.png` | `docs/screenshots/task8-clean-invoice-430-20260823.png` |

The same BO, Payments, Parking, and Invoice/PDF pages are also left open in the Codex in-app Browser. That Browser remained at its actual default `1280×720`; it was not represented as the exact 1470px or 430px evidence. Its current screenshots are the `task8-clean-*-browser-default-20260823.jpg` files.

At 430px, Payments retains readable metric cards and independent ledger rows; the IR page retains readable customer, vehicle, and inspection cards with only the intended internal wide control scrolling. Desktop and narrow captures show no document-level horizontal overflow.

## Invoice/PDF and session evidence

- Customer and office Invoice views use the immutable statement/Invoice source; the technician copy remains finance-free.
- Canonical and legacy PDF previews are generated locally in the browser from the validated statement and identity projection. Shared-uninvoiced orders do not expose a formal Invoice PDF.
- PDF unit coverage verifies A4 output, substantive localized line/totals/history text, source-aware title/number/file name, byte reuse between preview and download, signed overpaid balance, owner binding, and minimum label-to-amount geometry.
- Loaded identity changes and deterministic A→B→A success/error/`finally` races are covered for the composed financial, statement, customer, Parking, and Invoice reads; stale generations cannot republish old business or customer data.

## Verification

- `pnpm typecheck`: passed.
- `pnpm test:collaboration`: 11/11 passed.
- Final clean-model unit coverage: 881/881 passed in 6.0 minutes; the retired migration-only cases are no longer part of the suite. A later focused clean-seed/IR gate passed 79/79 after the final empty compatibility fields were removed.
- Final E2E coverage across the frozen tree is 241/241: the full run passed all 184 non-IR cases, then the three retired-photo seed expectations were corrected and the complete IR file passed 57/57. A final focused IR gate passed 4/4 after the last attachment compatibility field was removed.
- This E2E coverage includes Inspection Report, BO, Payments, Parking, Invoice/PDF, customer/vehicle, performance, settings, session switching, and exact 430px acceptance.

No source, Git history, user file, screenshot, or unrelated uncommitted change was deleted. No files were staged or committed.

final result: passed
