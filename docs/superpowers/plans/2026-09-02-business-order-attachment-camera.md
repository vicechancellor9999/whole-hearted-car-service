# Business Order Attachment Camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact camera/high-speed-document-camera capture entry to Business Order attachments and keep attachment cards image-led and narrow.

**Architecture:** Reuse the browser `MediaDevices.getUserMedia()` constraints and frame-capture utility already used by vehicle document scanning. Captured JPEG files enter the existing Business Order multipart attachment uploader with the currently selected category and optional description; no schema or new persistence endpoint is needed.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Playwright.

**Spec:** `docs/CONTINUATION_ENTRYPOINT.md`

## Global Constraints

- Preserve all existing uncommitted changes and business data.
- Keep generated files, logs, and project documentation under `/Volumes/公司文件`.
- Use the existing Business Order attachment upload API and supported file limits.
- The camera entry must remain usable by a future high-speed document camera exposed to macOS as a standard camera device.

---

### Task 1: Camera capture in the attachment workspace

**Files:**
- Modify: `apps/web/src/components/orders/formal-business-order-attachments-workspace.tsx`
- Test: `apps/web/tests/e2e/formal-handoff-cancellation.spec.ts`
- Test: `apps/web/tests/unit/formal-business-order-attachments-tab.spec.ts`

**Interfaces:**
- Consumes: `documentCameraConstraints(): MediaStreamConstraints`, `captureVehicleDocumentFrame(video: HTMLVideoElement): Promise<File>`, and `uploadFormalBusinessOrderAttachment(...)`.
- Produces: camera controls identified by `business-order-camera-open`, `business-order-camera-preview`, `business-order-camera-capture`, and `business-order-camera-close`.

- [x] **Step 1: Write the failing tests**

Add assertions that the attachment source contains the browser camera integration and that the rendered card stays at most 282 px wide with a description region at most 168 px wide.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm exec playwright test tests/unit/formal-business-order-attachments-tab.spec.ts tests/e2e/formal-handoff-cancellation.spec.ts --grep 'camera|摄像头|业务附件使用紧凑横向卡片'`

Expected: FAIL because the camera controls are absent and the current card is too wide.

- [x] **Step 3: Implement the minimal camera and compact-card UI**

Request a rear-facing high-resolution video stream without audio, assign it to the preview, capture a JPEG, upload it through `uploadFiles([file])`, stop all media tracks on close/unmount, and display a local permission/device error. Change the card list to wrapping fixed-width cards on tablet/desktop while retaining full-width cards on narrow screens and keeping the complete name in the `title` attribute.

- [x] **Step 4: Run focused and static verification**

Run:

```bash
pnpm exec playwright test tests/unit/formal-business-order-attachments-tab.spec.ts
pnpm exec playwright test tests/e2e/formal-handoff-cancellation.spec.ts --grep '业务附件使用紧凑横向卡片避免图片撑高列表'
pnpm typecheck:web
pnpm build
git diff --check
```

Expected: all commands pass.

- [x] **Step 5: Verify the live LaunchAgent runtime**

Restart `com.whcarservice.candidate-runtime`, verify launchd state and the process listening on port 3220, open `/orders/business/1?tab=attachments`, confirm the camera control and compact card dimensions, exercise the camera open/close path with a non-uploading test stream, and confirm the database still contains the same attachment count and charge version.
