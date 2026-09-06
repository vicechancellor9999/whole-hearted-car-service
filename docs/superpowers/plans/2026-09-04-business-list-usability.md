# Business list usability implementation plan

Goal: improve real front-desk list use within the current visual system. User authorized direct implementation and explicitly rejected the generated flat-screen concept. That concept is discarded, not an approved reference.

Scope: existing business-order list and collapsed navigation behavior. Preserve WH scheme 8 logo, current floating sidebar, semantic themes, APIs, permissions, all prior user changes and business calculations. The shipped `public/logo-icon.png` SHA-256 matches the supplied scheme 8 512px PNG exactly. No new logo or graphic assets.

Implementation: inline in existing isolated candidate worktree, port 3220. No data migration or business record writes.

- [x] Add and run failing filter contract tests: preserve other filters, reset page on filter change, clear independently, reject malformed pagination.
- [x] Implement `business-order-list-filters.ts`; wire existing URL-backed API filters to direct status buttons and clear-search control.
- [x] Keep current visual skeleton. Replace technical explanatory copy, put creation in page heading, strengthen vehicle identity and monetary alignment, keep list headers and pagination reachable with inner scrolling. Empty state must offer clearing filters; load failure retains retry.
- [x] Fix collapsed group navigation so clicking a group opens the existing sidebar instead of doing nothing.
- [ ] Run focused tests, Web typecheck/lint and production build. Validate real 3220 status/search/category combination, empty recovery, record navigation, create panel open/close without submitting, original logo and responsive layout.
- [x] Record exact verified scope and remaining work. Do not claim a whole-system redesign.

Design references: awesome-design-md informed restrained hierarchy, borders and density; the rejected generated screen is not used. Preserve actual current logo, color tokens and sidebar. No new statistics or placeholder business data.

Communication: Gmail profile `fulijian9999@gmail.com` verified accessible. User authorizes substantive questions there. No question currently blocks this UI work; no email sent and no ongoing mail monitor created.

## Verified delivery

- Seven focused unit tests passed; Web TypeScript and production build passed. Updated 3220 through the existing LaunchAgent; Next reported ready, and the browser rendered the new list with the existing saved business order.
- List/helper scoped ESLint passed. Sidebar lint still reports two pre-existing `react-hooks/set-state-in-effect` errors (automatic active-group expansion and stored collapse preference); not claimed as lint-clean.
- Browser: combined search `4321`, category `repair`, status `formally_handed_off` survived refresh. Switching to waiting-assignment showed a recoverable empty state; clearing all filters returned the record. Create panel opened/closed without submission. Record link navigated to `/orders/business/1`.
- Collapsed customer/vehicle group previously did nothing; after the fix it expands the sidebar and reveals the customer/vehicle links.
- Visually checked 1280×720 and 1600×900; no page horizontal overflow or main vertical overflow at the desktop size. Mobile CSS is implemented, but 390×844 live acceptance remains pending: browser viewport controls affected the selected reference tab, not the app tab. Do not claim mobile acceptance.
- No business records, monetary calculations, Logo assets, or Lark content were edited. This is a scoped usability increment, not acceptance of the requested broader visual redesign.

## User-supplied visual references (partial viewing)

All five public Douyin pages opened in the in-app browser after dismissing optional sign-in overlays. Only selected frames were examined; no claim of watching each full video or all eleven examples.

1. Vadym Krupa: https://www.douyin.com/video/7641921125110998464 — observed a dark AI-product scene with strong brand presentation. Use for presentation hierarchy, not as a ready-made operations layout.
2. SaaS dashboard collection: https://www.douyin.com/video/7653776929438408043?previous_page=web_code_link — observed a light blue-accent dashboard with charts, timeline, table and secondary right column. Remaining examples need closer review.
3. Dental SaaS: https://www.douyin.com/note/7419176123419921664 — observed sales list with side detail/payment overlay, plus account cards. Relevant to layered record handling, but accounting/procurement shown in the reference are outside this project's scope.
4. Wind monitoring: https://www.douyin.com/video/7635631760186254400 — observed grayscale turbine scene, orange status focal point, floating status and gauge cards. Potential overview inspiration; dense daily forms need a separate operational treatment.
5. SaaS landing page: https://www.douyin.com/video/7525737795403451688 — despite the shared title saying login, the observed frame is a 3D brand landing-page presentation with “Performance Optimization”, not an authentication form.

Next design work: use the user's WH scheme 8 source assets. Study these references by surface (brand entry / overview / operational workbench); produce a coherent visual and interaction treatment using actual business information. The present list increment does not settle that visual direction.
