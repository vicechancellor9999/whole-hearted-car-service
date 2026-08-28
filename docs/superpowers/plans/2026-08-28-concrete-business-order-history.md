# Concrete Business Order History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic Business Order history text with a precise, human-readable summary for every currently emitted audit event, including attachment uploads.

**Architecture:** Extract audit presentation into a pure formatter module so event payloads can be tested without rendering the full detail page. The UI will consume the formatter, retain compact timeline rows, and expose only meaningful changed fields.

**Tech Stack:** TypeScript 5.9, React 19, Vitest.

**Spec:** User-approved browser annotation on `/orders/business/1?tab=history` dated 2026-08-28; two `business_order.attachment_uploaded` events must identify the uploaded customer-signature files rather than use a generic fallback.

## Global Constraints

- Do not alter audit facts or existing event payloads.
- A known emitted event must never render as `完成一次业务操作`.
- Attachment summaries include category, media subtype and human-readable size without exposing storage keys.
- Unknown future events render a readable event type, not a false claim about what happened.

---

### Task 1: Pure Audit Summary Formatter

**Files:**
- Create: `apps/web/src/lib/orders/business-order-audit-presentation.ts`
- Create: `apps/web/tests/unit/business-order-audit-presentation.spec.ts`
- Modify: `apps/web/src/components/orders/formal-business-order-detail.tsx`

**Interfaces:**
- Produces: `businessOrderAuditSummary(eventType, after, masterData): string`
- Produces: `businessOrderAuditChanges(before, after, masterData): AuditPresentationChange[]`

- [ ] **Step 1: Write the failing formatter tests**

```ts
expect(businessOrderAuditSummary("business_order.attachment_uploaded", {
  category: "customer_signature", mediaType: "image/png", sizeBytes: 630724,
}, masterData)).toBe("上传客户签字附件（PNG，616 KB）");
expect(businessOrderAuditSummary("business_order.message_created", {
  messageId: 41, mentionedAccountIds: [2, 3],
}, masterData)).toBe("发布业务单留言，并 @ 2 人");
expect(businessOrderAuditSummary("business_order.future_event", {}, masterData))
  .toBe("记录业务事件：future event");
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --dir apps/web exec vitest run tests/unit/business-order-audit-presentation.spec.ts`

Expected: FAIL because the formatter module does not exist.

- [ ] **Step 3: Implement the closed event mapping and field formatting**

Implement explicit summaries for attachment upload/link, message create/edit, handoff cancellation, order voiding, document generation/revision, payment, refund, assignment, return, charge and note events. Format bytes with one of `B`, `KB`, `MB`; map `customer_signature`, `service_photo`, `financial_evidence`, and `other` to user-facing Chinese.

- [ ] **Step 4: Replace component-local formatters with imports**

`historyItems` must call the pure formatter. Remove `AUDIT_EVENT_LABELS`, `AUDIT_FIELD_LABELS`, `auditBusinessSummary`, `auditChanges`, and their helper maps from the component after the new module owns them.

- [ ] **Step 5: Run focused and existing Business Order tests**

Run: `pnpm --dir apps/web exec vitest run tests/unit/business-order-audit-presentation.spec.ts tests/unit/formal-business-orders.spec.ts`

Expected: all tests PASS and no test contains the generic known-event text.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/orders/business-order-audit-presentation.ts apps/web/tests/unit/business-order-audit-presentation.spec.ts apps/web/src/components/orders/formal-business-order-detail.tsx
git commit -m "fix: explain business order history events"
```

