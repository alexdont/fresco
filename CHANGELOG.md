# Changelog

All notable changes to Fresco are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.3.1 — 2026-05-17

Fix `:pan_optimized` not actually engaging in OSD 4.1.x. The 0.3.0
fast-pan installer probed for `viewer.drawer.draw`, but OSD's
modern canvas drawer (4.1 onwards) exposes `.update()` instead —
no `.draw()` method exists on the drawer object. The check
silently returned, so the fast path never engaged for anyone on
the default OSD version Fresco pins to. Consumers saw no perf
change between `pan_optimized={true}` and the default; the new
event was never emitted.

This patch is a true no-op for behavior unless you're on
`:pan_optimized` — in which case it switches you from "silently
inert" to "actually engaged."

### Fixed

- `installFastPan` now probes for both `drawer.update` and
  `drawer.draw` and suppresses whichever exists. OSD 4.1.x uses
  `update`; older or custom drawers may still use `draw`. Being
  defensive about both shapes means future drawer revisions
  don't silently break the fast path again.
- `commitFastPan` now triggers the post-pan repaint via
  `viewer.forceRedraw()` (a stable OSD public API) instead of
  calling the (potentially-renamed) drawer method directly.
- Added `console.warn` on every silent-bail path inside
  `installFastPan` / `startFastPan`. Previously, if the install
  early-returned (no drawer, rotate active, unknown drawer
  methods, missing canvas), the consumer had no signal — the
  fast-pan event just never fired. Now developers see exactly
  why the fast path didn't engage.

### Notes

- No public API changes. `:pan_optimized` attr and `fast-pan`
  event surface are identical to 0.3.0. Etcher 0.2.8's
  subscription continues to work unchanged.
- After upgrading, `pan_optimized={true}` viewers will now
  actually fire `fast-pan` events. Overlay extensions (Etcher
  ≥ 0.2.8) will start receiving them and applying the matching
  CSS transform.

## 0.3.0 — 2026-05-17

CSS-transform pan fast path tuned for long-scroll reading content
(manhwa / manga / comics / document viewers) where the user is
panning continuously, not zooming. Opt-in via a new `:pan_optimized`
attr on `Fresco.viewer/1`. Default off — existing viewers see no
behavior change. Bumped to minor because the release introduces a
new public attr and a new synthetic event (`fast-pan`) that overlay
extensions need to coordinate with.

### Added

- New `:pan_optimized` attribute on `Fresco.viewer` (defaults
  `false`). When `true`, the JS hook installs a pan interceptor
  that temporarily swaps OSD's drawer for a no-op during the
  gesture, applies a GPU-composited `transform: translate3d` to
  OSD's canvas element per frame, and emits a `fast-pan` event in
  three phases (`start`, `delta`, `end`). Drops per-frame cost
  from ~10–20ms to <1ms on iOS Safari for pure-pan motion. Bails
  to OSD's normal redraw path on zoom-change, overscan (cumulative
  delta > 50% of viewport height), and when `:rotate` is also
  active (rotation invalidates the simple translate math).
- New `fast-pan` event in the `handle.on(eventName, fn)` channel.
  Only emitted when `:pan_optimized` is set on the viewer. Payload:
  `{ phase: "start" | "delta" | "end", x, y }` with cumulative
  screen-pixel offset. Overlay extensions apply the same
  `translate3d(x, y, 0)` to their container so they stay aligned
  with the canvas during the fast-path window. [Etcher](https://hex.pm/packages/etcher)
  `>= 0.2.8` listens automatically.
- New `handle._emit(eventName, payload)` internal method on the
  viewer handle for Fresco's own modules to fire synthetic events
  through the existing subscriber list. Underscore-prefixed
  because consumers should never call it — emit is owned by
  Fresco's internals; consumers listen via `handle.on(...)`.

### Notes

- No breaking changes. The fast-pan event is emitted only when the
  consumer opts into `:pan_optimized`; older Etcher (or any other
  overlay) paired with non-opted viewers sees nothing different.
- Older Etcher (`< 0.2.8`) paired with a `:pan_optimized` viewer
  will see annotations visibly drift during the pan window. Either
  upgrade Etcher or hold off on opting in to `:pan_optimized` until
  Etcher is on `>= 0.2.8`.
- Tessera (the DZI deep-zoom layer) is unaffected — it's a source
  provider, no overlay.

## 0.2.0 — 2026-05-15

Official, documented escape hatch to the underlying OpenSeadragon Viewer
instance. No breaking changes — `handle.viewer` (the original undocumented
name) remains supported as a back-compat alias. Bumped to a minor version
because the new field carries a public stability obligation (Fresco can no
longer freely rename or reshape the OSD viewer reference), not because the
code change itself is large — it's a one-line aliasing.

### Added

- `handle.openSeadragon` — official, documented access to the underlying
  OpenSeadragon Viewer for advanced consumers and layered packages. Use it
  for OSD APIs Fresco doesn't expose first-class: custom pan/zoom
  constraints (`panHorizontal`, `minZoomImageRatio`, …), raw OSD event
  handlers (`canvas-double-click`, `canvas-key`, …), OSD plugin
  registration, gesture rebinding. See the new "Advanced: OSD escape
  hatch" section in `README.md` for the stability contract — in
  particular, the rule that consumers reaching for it routinely should
  file an issue so common patterns can graduate to first-class Fresco
  APIs.

### Notes

- `handle.viewer` (the existing back-compat alias for `openSeadragon`)
  remains supported indefinitely. [Etcher](https://hex.pm/packages/etcher)
  already depends on this field across five call sites for image-space
  coordinate math — that's the in-tree consumer whose usage pattern
  motivated formalizing the contract. New code should prefer
  `handle.openSeadragon`; Etcher can migrate at its own pace.
- No breaking changes; no behavior changes for existing consumers.

## 0.1.6 — 2026-05-15

Documentation + test polish patch. No changes to the rendered output
of `Fresco.viewer/1` — every existing call site behaves exactly as
in 0.1.5. The goal is to make Fresco's genericity (works for any
Phoenix app, not just daisyUI consumers) more visible to a new
reader, and to backfill render-assertion tests for the attributes
added in 0.1.4 / 0.1.5.

### Changed

- README: clarified that the daisyUI mapping for `theme={:inherit}`
  is one example among many — any CSS custom properties or fixed
  colors work. Added a second bare-color example so readers don't
  infer that daisyUI is required.
- README: surfaced the `theme={:system}` dark-mode default that
  landed in 0.1.4 with a "Heads up" callout in the Theming section,
  so consumers upgrading from 0.1.3 aren't caught off guard by
  viewers rendering dark on dark-OS machines.
- README: documented the `FrescoViewer` hook name explicitly so
  consumers maintaining an explicit hooks map (rather than spreading
  `window.FrescoHooks`) know what key to register.
- README: promoted the first-source-only caveat for
  `handle.imageToScreen` / `screenToImage` to a visible `⚠️ Caveat`
  callout in the multi-image section, with one extra sentence on
  what extension authors should do until multi-image disambiguation
  ships.
- README + viewer attr doc: rotation section now says "fifth button"
  (the row of four built-in buttons + a fifth opt-in rotation
  button) instead of "fifth icon".
- `priv/static/fresco.js`: documented the rationale for pinning
  OpenSeadragon to `4.1.0` so future maintainers know the bump
  contract.

### Tests

- Added render-assertion coverage for `:theme` (all four values),
  `:sources` (multi-image JSON payload), `:infinite_canvas`
  (modifier class + data attribute), `:rotate` (data attribute), and
  the `ArgumentError` guard that fires when neither `:src` nor
  `:sources` is provided.

## 0.1.5 — 2026-05-15

One additive feature — a fourth `:theme` value, `:inherit`, that lets
the parent app drive Fresco's palette via the existing `--fresco-*`
CSS custom properties. Use it to wire the viewer to a parent theme
system (daisyUI, Tailwind, custom palettes) so background, dot grid,
and nav buttons follow the parent theme as it changes. Fully
backwards compatible — existing `:system`/`:light`/`:dark` viewers
behave exactly as in 0.1.4.

### Added

- New `:inherit` value on `Fresco.viewer`'s `:theme` attribute. When
  set, Fresco emits `data-fresco-theme="inherit"` on the host div
  and **skips its own var declarations** for that viewer — the six
  `--fresco-*` properties stay unset until the parent app's CSS
  defines them. Pair with a CSS rule on
  `.fresco-viewer[data-fresco-theme="inherit"]` mapping the
  variables to the parent's theme tokens. The structural styles
  (background-color + dot grid pattern) still apply; only the color
  values come from the parent.

### Changed

- The base `.fresco-viewer { --fresco-bg: …; … }` rule is now scoped
  to `.fresco-viewer:not([data-fresco-theme="inherit"])` so it
  doesn't fight the parent's vars. The `@media (prefers-color-scheme:
  dark)` branch picks up the same `:not()` exclusion. Visible only
  to consumers who pass `theme={:inherit}`; everything else stays
  the same.

## 0.1.4 — 2026-05-14

Three additive features — opt-in 90° rotation, multi-image canvas
layout, and light/dark/system theming. The API surface stays
backwards-compatible (all existing attrs unchanged, all new attrs
have defaults), but the new `:theme` defaults to `:system`, which
means viewers on dark-OS machines will now follow
`prefers-color-scheme` and render dark by default. Pass
`theme={:light}` to lock to the old always-light look.

### Added

- New `:rotate` attribute on `Fresco.viewer` (defaults to `false`).
  When `true`, appends a 90°-clockwise rotation button between the
  Fullscreen and Zoom-in icons. Rotation is tracked independently
  of zoom/pan — "Reset view" deliberately doesn't undo it.
- New `:sources` attribute for laying multiple images out on one
  canvas. Each entry is a `%{src, x, y, width}` map in viewport
  units; the first image conventionally anchors the layout at
  `width: 1`, so `x: 1.1` puts the next image just to the right.
  Heights derive from each image's natural aspect ratio. Each
  entry's `src` runs through the same source-provider chain as
  `:src`, so plain images and DZI tile pyramids (via Tessera) can
  be mixed on a single viewer. Live re-renders that change the
  list re-open the viewer while preserving the current zoom/pan.
- `:src` is now optional. At least one of `:src` or `:sources`
  must be given; the component raises otherwise. Existing
  single-image callers keep working unchanged.
- New `:theme` attribute — `:system` (default), `:light`, or
  `:dark`. Plumbed to `data-fresco-theme` on the host div.
  `:system` follows the OS via `prefers-color-scheme`; the other
  two force a fixed palette regardless of OS preference.
- Six CSS custom properties on `.fresco-viewer` expose the entire
  palette surface: `--fresco-bg`, `--fresco-grid-dot`,
  `--fresco-nav-bg`, `--fresco-nav-bg-hover`, `--fresco-nav-fg`,
  `--fresco-nav-focus`. Override them in user CSS to wire fresco
  to a parent theme system (daisyUI, Tailwind, custom palettes) —
  README has a daisyUI mapping example.

### Changed

- Default viewer rendering follows `prefers-color-scheme` (`:theme`
  defaults to `:system`). Viewers on dark-OS machines that
  previously rendered light will now render dark unless explicitly
  pinned via `theme={:light}` or an inherited explicit theme.
- `handle.imageToScreen` / `handle.screenToImage` continue to
  operate on the first source when multiple are present.
  Multi-image coordinate disambiguation is planned but not yet
  implemented.

## 0.1.3 — 2026-05-14

Opt-in infinite-canvas mode + a default dot-grid background. No
breaking changes — every existing viewer keeps the stock clamped
behavior unless `infinite_canvas` is explicitly set, and the
grid is invisible by default (OSD's canvas paints over it).

### Added

- New `:infinite_canvas` attribute on `Fresco.viewer` (defaults to
  `false`). When `true`:
  - `visibilityRatio` drops to `0` and `constrainDuringPan` flips
    to `false`, so the user can pan freely beyond the image edges.
  - `minZoomImageRatio` lowers to `0.05` so the image can shrink
    to a thumbnail in the middle of a vast canvas.
  - The void around the image lights up with the dot-grid
    background (see below); the host also picks up a
    `.fresco-viewer--infinite` modifier class for any
    infinite-only styling consumers want to add.
- Subtle 24×24px dot-grid background on every Fresco viewer (via
  the new `.fresco-viewer` base class on the host div). Hidden by
  default because OSD's canvas paints over it; visible in the
  void when `infinite_canvas` is on, or behind transparent /
  padded images. Override `.fresco-viewer` in your own CSS for
  dark mode or a different accent.
- Documented future API: a planned `:sources` attribute will
  accept a list of `[%{src: "...", offset: {x, y}}]` for
  multiple images on the same canvas. The current `:src` stays
  as the single-image shortcut — no migration when `:sources`
  ships.

## 0.1.2 — 2026-05-14

Small UX + extension-API patch release. No breaking changes for
existing consumers; the click-to-zoom default flip is documented
below because it's user-visible.

### Added

- `handle.appendNavButton(...)`'s returned remover now carries
  `.setIcon(svgString)`, `.setTitle(text)`, and `.el` (the underlying
  `<button>` element). Extensions can mutate a button after creation
  without re-adding it (which would reshuffle its position in the
  nav column). Used by [Etcher](https://hex.pm/packages/etcher)
  0.2's visibility toggle to flip eye ↔ eye-slash.

### Changed

- Mouse single-click no longer zooms. `gestureSettingsMouse.clickToZoom`
  defaults to `false`; `dblClickToZoom`, scroll-to-zoom, and
  pinch-to-zoom on touch are unchanged. Single clicks now reliably
  pass through to overlays that want them (e.g. annotation selection)
  instead of fighting OSD's built-in click-to-zoom.

## 0.1.1 — 2026-05-12

Small additive release for layered libraries. No breaking changes.

### Added

- `handle.appendNavButton(svg, title, onClick)` — extensions append a
  button to the same `.fresco-nav` flexbox column that holds the
  built-in zoom-in / zoom-out / reset / fullscreen. Returns an
  unsubscribe function that removes the button on cleanup. Used by
  [Etcher](https://hex.pm/packages/etcher) to add a pencil button
  that toggles annotation mode.
- `animation` and `update-viewport` events bridged on the viewer
  handle (`handle.on("animation", fn)`). The existing `zoom` / `pan`
  events only fire on the *intent* of an input; the new ones fire
  on every spring-interpolated frame so overlays glide with the
  image instead of jumping at endpoints.

### Changed

- `<Fresco.viewer>` now sets `phx-update="ignore"` on its host div.
  Without it, LiveView morphdom patches walk the viewer's children
  on every render and wipe OSD's runtime-added canvas + extension
  overlays. The hook still receives `updated` callbacks for
  attribute changes (e.g. `data-src` swaps continue to work) —
  `phx-update` protects children only.
- Nav column reordered top-to-bottom: fullscreen → zoom-in → zoom-out
  → reset. Extensions appending via `handle.appendNavButton` land at
  the bottom of the column.

## 0.1.0 — 2026-05-12

Initial release. Polished pan-zoom image viewer for Phoenix apps, with a
deliberate extension surface for layered libraries.

### Built-in viewer

- `<Fresco.viewer id src class>` LiveView function component
- Pan: click-drag, touch-drag, keyboard arrows
- Zoom: mouse wheel, pinch, double-click, dedicated buttons, `+` / `-` keys
- Fit-to-view initial state regardless of image / container aspect ratio
- Heroicons nav overlay at top-left: zoom-in, zoom-out, reset, fullscreen
- Viewport clamped so the image can't be panned off-screen
  (`visibilityRatio: 1.0`, `constrainDuringPan: true`)
- Smooth animations tuned for snappy responsiveness
  (`animationTime: 0.3`, `springStiffness: 10`)
- Browser fullscreen mode

### Extension surface

- `window.Fresco.viewerFor(domId)` — synchronous lookup of a live viewer handle
- `window.Fresco.onViewerReady(domId, callback)` — async-safe lookup that fires
  the callback as soon as the viewer is ready (handles mount-order races
  when an extension hook mounts before its host viewer)
- `window.Fresco.registerSourceProvider(predicate, factory)` — registers a
  predicate-matched URL transformer; first registered provider that matches
  wins, falling back to a default plain-image provider
- Viewer handle exposes: `imageToScreen` / `screenToImage`,
  `getViewportBounds`, `fitBounds`, `setSource`,
  `swapSourcePreservingBounds`, and `on(event, handler)` for `zoom` / `pan`
  / `open` / `resize` events

### JS engine

- OpenSeadragon ~> 4.1 lazy-loaded from jsDelivr on first mount
- One bundled JS file (`priv/static/fresco.js`); no npm dep, no build step
  in consumer apps
- Heroicons SVGs inlined; no PNG sprite dance against a CDN

### Requirements

- `phoenix_live_view ~> 1.1`, `phoenix_html ~> 4.0`, `jason ~> 1.4`
