# M0 Working Tree Ownership and Baseline Record

Status: engineering ownership record; not a business-rule approval
Branch at capture: `codex/formal-foundation`
Design commit at capture: `a042306`
Observed working tree: 60 modified paths and 651 untracked files

| Group | Observed files | Disposition |
|---|---:|---|
| Root formal source, schema, migrations, scripts, tests, configs | 109 untracked files plus 60 modified paths | Verify and commit as the formal baseline |
| `apps/web` PC visual source | 540 untracked files | Verify and commit separately as isolated non-production reference |
| `apps/qa/playwright-results` | 1 generated file | Keep on disk if useful, ignore from Git, never treat as acceptance evidence |
| Root `eng.traineddata` | 1 unreferenced binary | Preserve in the external source snapshot, ignore from Git, do not deploy |
| `.runtime` PostgreSQL/uploads | ignored runtime | Preserve only in the stopped-runtime archive, never commit |
| `.env.local` files | ignored credentials | Keep local, never copy to source archive or Git |

The files `docs/architecture/FORMAL_SYSTEM_BUSINESS_BASELINE.md` and
`docs/acceptance/FORMAL_SYSTEM_END_TO_END_ACCEPTANCE.md` are candidate business
and acceptance material. Recording them in Git preserves provenance; it does
not approve their business rules.
