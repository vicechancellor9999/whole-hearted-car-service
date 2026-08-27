# Team Card Spacing and Hover Design

## Context

The desktop team-performance grid currently uses `lg:pt-0`, so the four team cards begin directly against the header divider. The user marked this boundary and selected the option that adds breathing room without compressing the cards. The user also asked the four team cards to use the same shadow and small hover movement as the KPI cards below.

## Approved visual change

- At `lg` desktop widths, add `12px` between the team header divider and the first row of team cards.
- Increase the desktop grid and team section height by the same `12px`, preserving the current team-card height and internal content spacing.
- Leave the existing mobile top padding unchanged.
- Give every team card the existing KPI-card surface behavior:
  - normal state uses the shared `shadow-card` token;
  - hover lifts by `2px` (`-translate-y-0.5`);
  - hover border changes to `primary-200`;
  - hover shadow changes to `shadow-card-hover`;
  - the transition uses the existing `200ms` duration.
- Preserve current links, text, values, colors, progress bars, dark surfaces, and responsive column rules.

## Implementation boundary

The change belongs only in `src/components/dashboard/team-performance.tsx`. No data contract, route, asset, or other dashboard card changes are required.

## Verification

- Add a failing desktop E2E assertion that the header-to-card gap is `12px` within a small rendering tolerance.
- Preserve the existing equal-height card check and update the expected downstream desktop geometry by `12px`.
- Add an E2E hover assertion proving the first team card receives a non-zero upward transform and a stronger shadow.
- Re-run the full dashboard E2E suite, collaboration tests, typecheck, lint, and production build.
- Capture light/dark desktop and 430px mobile screenshots, then review a same-size comparison focused on the changed team section.

## Non-goals

- No card redesign, new content, animation library, or mobile height change.
- No changes to the lower KPI-card interaction pattern.
