# Business Order Problem Description Phase 1 Delivery

Date: 2026-08-31 (America/Jamaica)

This delivery implements phase 1 of `docs/superpowers/specs/2026-08-31-inspection-report-and-problem-description-design.md` in the candidate runtime.

## Delivered behavior

- Business Order creation accepts an optional bilingual problem description and records an explicit immutable original even when empty.
- Business Order current descriptions and each repair round use independent append-only version histories with optimistic concurrency and audit summaries.
- The detail view shows current context prominently, shows a distinct round context only when it differs, and provides separate edit/history actions.
- Business attachments are a dedicated fifth workspace tab; the document tab is limited to document generation, revision selection, preview, download and print.
- Newly generated customer, office and mechanic A4 documents freeze the exact original/current-round description facts they use. Version-1 snapshots remain readable.
- Record deletion previews and authorized execution include the original, Business Order version and round-version records in dependency order.

## Migration and preservation evidence

- Candidate runtime backup: `backups/20260831-060301-EST/candidate-runtime-before-0040.tar.gz`
- Archive SHA-256: `3f37c219ec9a9f38bd1d7a2146b0e870868a232a92a1a471766a50b99dd24c26`
- Cold restore rehearsal: passed.
- Before/after counts remained unchanged: 1 Business Order, 1 repair round, 3 documents, 2 Business Order attachments and 34 stored files.
- Stored-file hash manifest remained `d31058bf8dde3afe55cbfa0e0184f5325e54e8bf2ca86aee2a0f97e21b07e1b5`.
- Migration backfilled 1 immutable original row for the 1 existing Business Order.
- Database migration count after `0041_problem_description_record_deletion.sql`: 41.

## Verification evidence

- Backend: 120 test files, 453 tests passed.
- Web: 1046 tests passed with one worker.
- Root and web TypeScript checks passed.
- Production Next.js build passed and generated all 55 static pages.
- ESLint passed with zero errors and one pre-existing unused-test-parameter warning.
- `git diff --check` passed.
- Candidate production runtime is available at `http://127.0.0.1:3220/`; `/login` returned HTTP 200.

Automated in-app browser acceptance was blocked by the browser-control local-URL policy. No alternate browser-control path was used. Visual acceptance therefore remains a user-visible check on the already-running candidate, while automated API, schema, service, component, build and migration checks are complete.

## Commits

- `4519c20` add versioned order problem descriptions
- `3b55a0f` expose order problem description history
- `5b759b7` capture order problem descriptions at creation
- `ccd9dd3` present and version order problem descriptions
- `083f038` add dedicated order attachments workspace
- `21278b7` freeze problem descriptions in order documents
- `e677048` include problem descriptions in record deletion
- `aac4c23` stage deletion authorization as a follow-up migration
- `d202abc` update legacy service suites for the new schema

## Next implementation boundary

The next phase is the expanded Inspection Report domain: immutable original submissions and multi-attachment intake, report/quotation versions and four-stage workflow. AI runs/dialogue, report A4 files, customer follow-up and Business Order adoption remain later phases defined in the confirmed specification.

