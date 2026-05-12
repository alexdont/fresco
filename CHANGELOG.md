# Changelog

All notable changes to Fresco are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
