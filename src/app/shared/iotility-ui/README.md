# IoTility shared UI (copied)

These are IoTility's shared components, copied from `iotility@035c514` (branch `qpmc`),
`projects/shared-ui/src/lib/`. They keep their selectors (`shared-dropdown`, `ui-skeleton`,
`ui-chart-card`, `[sharedTabIndicator]`, `[tooltip]`, `[uiCountUp]`…) and are imported as
`@iotility/shared-ui` (a `tsconfig.json` path to `public-api.ts`), the same way IoTility imports
them. That lets them move into a shared package later without touching any call site.

Keep the copies close to the source so IoTility fixes can be synced. The only local changes:

- Every stylesheet's `@reference "../../styles/theme.css"; @reference "tailwindcss";` is
  replaced by `@reference "../../../../styles.css";` (the COB's global stylesheet, which
  imports the same theme).
- Raw palette classes (`bg-slate-200`, `theme(colors.slate.700)`…) in the skeletons and chart
  skeletons use the `line` / `dark-line` / `canvas` tokens instead.
- `charts/echarts-setup.ts` also registers ECharts 6's `LegacyGridContainLabel`. The charts use
  `grid.containLabel`, which ECharts 6 ignores without it (it logs a warning in IoTility too).

Assets the components load (`assets/fleetpoint/icons/*`, `assets/blocking-loader.svg`) are
copied into `public/assets/` from IoTility.
