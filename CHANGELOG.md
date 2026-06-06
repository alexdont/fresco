# Changelog

All notable changes to Fresco are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.7.0 — 2026-06-06

### Added

- **`handle.setSources(sources, opts)` — replace a `<Fresco.canvas>`'s image
  set in place.** Swaps the current images for a new set without remounting
  the DOM, so state tied to the page session — Pointer Lock, audio/video
  pipelines, peer overlays bound via `handle.on(...)` — survives. `sources`
  is an array of `{src, x?, y?, width?, height?, id?, z_index?}` (the
  `getImages()` shape; `w`/`h` accepted as aliases). `opts` accepts
  `reset_view` (default `true`, fit-to-canvas after the swap; `false` keeps
  the current pan/zoom), an optional `extensions` map (replaces canvas-level
  extensions atomically with the swap, e.g. `extensions.etcher.annotations`),
  and optional `canvasWidth` / `canvasHeight` (else the new images' bounding
  box). Returns a Promise that resolves once the first new frame is decodable
  and rejects on empty/malformed input. Fires the existing `open` event plus
  a new `sources-changed` event so overlays rebuild. Programmatic-only and
  additive — the initial-mount path and all existing handles are unchanged.

### Fixed

- **`[data-fresco-suppress-tap]` probe now works for shapes with
  `pointer-events: none`.** The 0.5.9 implementation used
  `document.elementsFromPoint(x, y)` to walk hits under the tap
  point, but `elementsFromPoint` honors `pointer-events` per
  spec (verified across Chrome / Safari / Firefox) — so the
  probe silently missed every Etcher annotation, since Etcher
  applies `pointer-events: none` to non-editing `.etcher-shape`
  nodes so pan/zoom passes through. The visible bug: tapping an
  annotation near a paged-reader's left/right tap zone fired
  BOTH Etcher's tooltip-pin AND Fresco's tap (consumer page
  navigation flipped the page, modal opened in the background).
  Replaced with a `document.querySelectorAll("[data-fresco-suppress-tap]")`
  walk + per-node `getBoundingClientRect` bbox test against the
  tap point. Same API contract for consumers; the suppression
  now actually fires.

No API changes; Etcher and any other consumer using
`data-fresco-suppress-tap` benefits immediately.

## 0.6.2 — 2026-05-24

Docs-only release. Companion note for `etcher 0.5.0` /
`fresco_strip 0.2.0`'s deep-link work, which surfaced that the
coordinate-space convention `<Fresco.canvas>` uses was implicit —
spelled out anywhere code consumes geometry off the canvas handle.

### Docs

- **`Fresco.Canvas.canvas/1`** now has an explicit "Coordinate
  space" section in its function doc, clarifying that
  `fitBounds`, `screenToImage` / `imageToScreen`, the extent
  reported by the canvas handle's `getCanvasSize()`, and any
  geometry persisted by peer libraries (Etcher shape geometry,
  ML overlay boxes) all live in canvas-pixel space — distinct
  from the per-image source-pixel space used by
  `<FrescoStrip.viewer>`.

No code changes.

## 0.6.1 — 2026-05-24

### Fixed

- **`window.Fresco.onViewerReady` / `viewerFor` / `onReady` now
  resolve handles registered by `fresco_strip` 0.1.0+.** 0.6.0
  shipped with `viewerRegistry` and `readyCallbacks` as
  closure-local vars inside `fresco.js`, while `fresco_strip`
  registered handles into `window.Fresco.viewerRegistry`. Two
  separate maps, no convergence — consumer calls to
  `onViewerReady("strip-id", cb)` queued in fresco's private
  map and never fired (the handle was on the other side).

  Both registries now point at the same `window.Fresco.viewerRegistry`
  / `window.Fresco._readyCallbacks` objects. Loading order
  doesn't matter: whichever package's JS runs first creates the
  shared maps; the other piggy-backs.

  Also swapped `window.Fresco = {...}` (which would clobber any
  pre-existing global from a sibling package) for
  `Object.assign(window.Fresco, {...})` so the public-method
  install cooperates with whichever package loaded first.

  No API change. Consumers calling `window.Fresco.viewerFor(...)`
  or `window.Fresco.onViewerReady(...)` against a
  `<FrescoStrip.viewer>` host now work as documented.

  Future hex-published peer packages (planned tiles package,
  custom overlays, etc.) should plug into the same
  `window.Fresco.viewerRegistry` / `window.Fresco._readyCallbacks`
  globals — that's now the canonical contract.

## 0.6.0 — 2026-05-24

`<Fresco.scroll_strip>` has been extracted into its own package,
[`fresco_strip`](https://hex.pm/packages/fresco_strip). Consumers
who only need the viewer / canvas surface (lightboxes, paged
readers, document viewers, lookbooks) now ship with ~19% less
code; consumers who need strip mode pick up `fresco_strip` as a
sibling dependency. Both packages contribute handles to the
same `window.Fresco.viewerRegistry` so peer libraries (Etcher
annotations, ML overlays, comment threads) keep working
uniformly across both.

### Removed (breaking)

- **`<Fresco.scroll_strip>`** — moved to `fresco_strip` as
  `<FrescoStrip.viewer>`. Component attrs, JS hook, handle API,
  extension contract, and `data-*` semantics are byte-for-byte
  unchanged.
- **`Fresco.ScrollStrip` module** — moved to `fresco_strip` as
  `FrescoStrip.Viewer`.
- **`defdelegate scroll_strip(assigns)`** on `Fresco`.
- **`makeStripHandle` JS factory** + **`FrescoScrollStrip`
  LiveView hook** — moved to `fresco_strip/priv/static/fresco_strip.js`.
- **`.fresco-strip-*` CSS rules** — moved to fresco_strip's
  injected stylesheet.

### Migration

```diff
 # mix.exs
 defp deps do
   [
-    {:fresco, "~> 0.5.9"}
+    {:fresco, "~> 0.6.0"},
+    {:fresco_strip, "~> 0.1.0"}
   ]
 end

 # assets/js/app.js
 import "../../deps/fresco/priv/static/fresco.js"
+import "../../deps/fresco_strip/priv/static/fresco_strip.js"

 # template
-<Fresco.scroll_strip id="reader" sources={@pages} extensions={@ext} />
+<FrescoStrip.viewer  id="reader" sources={@pages} extensions={@ext} />
```

Three lines per consumer. **Etcher 0.4.12+** handles
`FrescoStrip.viewer` automatically — it detects the strip
handle at runtime via `"scrollTo" in handle` and routes through
its existing strip-renderer. No Etcher code change required.

### Why now

Most recent changes lately have been strip-only. Splitting lets
strip iterate on its own release cadence and lets viewer /
canvas consumers stop reading changelog entries that don't
affect them. Boundary was already clean — strip didn't share
anything with the engine — so the extract is mostly file
movement, not refactoring.

## 0.5.9 — 2026-05-24

Two opt-in ways for peer libraries (Etcher annotations, ML
overlays, comment threads) to suppress the `tap` event when the
tap was actually meant for them. Backwards-compatible — neither
path engages unless a consumer asks for it.

### Added

- **`handle.suppressNextTap(ms?)`** on viewer + canvas handles.
  Default window 250 ms. Any tap landing within the window is
  swallowed; the window is additive (re-calls extend the deadline
  to the later of the two). Etcher calls this after committing a
  freshly-drawn shape so the iOS-synthesized mousedown/mouseup →
  `tap` that follows doesn't race the consumer's tap-zone
  navigation.
- **`[data-fresco-suppress-tap]` element attribute** — any element
  under the tap point with this attribute (or whose ancestor has
  it) suppresses the emit. Detected via
  `document.elementsFromPoint`, so `pointer-events: none` elements
  (like `.etcher-shape`) are still found. Etcher stamps it on
  every shape element from 0.4.11+ so tapping an existing
  annotation pins the tooltip without bubbling to consumer-side
  tap-zone navigation.

  Both paths are independent — consumers can use either, both, or
  neither. Both default to off; existing consumers see no change.

## 0.5.8 — 2026-05-21

### Fixed

- **`handle.setRotation` / `getRotation` / `rotateBy` on
  `<Fresco.canvas>`** no longer throw `TypeError: controller.X is
  not a function`. 0.5.7 added the methods on the engine + wired
  the public handle proxy, but `mountFrescoCanvas`'s controller
  layer in between forgot to re-export them — so every call to
  the public API tripped the missing controller method. The
  engine-level rotation (and Fresco's built-in `Rotate 90°` nav
  button, which calls the engine directly) was unaffected.

  Same family of leak that 0.5.6 fixed for `setHomeAction` /
  `setPanBounds` / `getTransform`; this release closes the
  matching gap for the new 0.5.7 methods.

- **`handle.zoomIn` / `zoomOut` / `toggleFullscreen` / `requestHome`
  on `<Fresco.canvas>`** were silently broken by the same gap
  (the engine had them, the handle proxied through, the
  controller didn't re-export). Fixed in lockstep.

## 0.5.7 — 2026-05-21

90°-snapped content rotation on `<Fresco.viewer>` and `<Fresco.canvas>`
as a first-class transform parameter, plus programmatic equivalents of
every nav button so consumers can hide the built-in chrome and wire
their own UI to the same actions. Backwards-compatible — the default
rotation is `0`, `nil` `:nav_buttons` still enables every button, and
every existing consumer keeps its current behavior.

### Added

- **`handle.setRotation(deg)` / `getRotation()` / `rotateBy(delta)`**
  on viewer + canvas handles. Input is snapped to the nearest 90°
  multiple and normalized to `[0, 360)`; `setRotation` is a no-op
  when the snapped value matches the current rotation. `rotateBy`
  is sugar for `setRotation(getRotation() + delta)`. Every rotation
  change auto-re-homes through `requestHome()` — so any consumer
  `setHomeAction` (a paged reader's "fit current page", for
  example) fires after the rotation lands. Without this, a 90°
  rotation at the previous `tx, ty` would push the content off
  the side; with it, the rotated content always lands centered
  on the consumer-chosen target.
- **`rotate` event** on the handle bus. Payload
  `{rotation, previous}` — fires once on every actual rotation
  change. Extensions that cache screen-px values (overlay HUDs,
  layered SVGs) subscribe to invalidate.
- **`:initial_rotation` component attr** on `<Fresco.viewer>` and
  `<Fresco.canvas>` (default `0`). Read at mount, snapped, applied
  before the first paint so the host can persist a per-image
  rotation server-side without a flash of unrotated → rotated.
  Mirrors as `data-initial-rotation` on the host element.
- **`Rotate 90°` nav button** in the built-in nav column. Cycles
  `0 → 90 → 180 → 270 → 0` per click. Gated by the existing
  `:nav_buttons` allowlist via the `:rotate` atom (default `nil`
  enables it).
- **`rotation` field** on `handle.getTransform()`'s return
  (`{tx, ty, s, rotation}`). Same composite-transform consumers
  build for layered overlays now have the angle available without
  a separate getter call.
- **Programmatic nav-action methods** on both viewer and canvas
  handles: `zoomIn(factor?)`, `zoomOut(factor?)`,
  `toggleFullscreen()`, `requestHome()`. Identical step factors
  + anchors as the built-in nav buttons (1.4× / 1/1.4× around the
  viewport center; `requestHome` flows through any active
  `customHome` set via `setHomeAction`). Lets consumers hide the
  built-in chrome and wire their own buttons / keyboard shortcuts /
  accessibility affordances to the exact same behavior.
- **Empty `:nav_buttons` / `:gestures` list now means "hide
  everything"** instead of falling back to the default of "all
  enabled." Pass `nav_buttons: []` on `<Fresco.viewer>` /
  `<Fresco.canvas>` to render no built-in chrome at all (the
  Elixir side emits `data-nav-buttons="none"` as a sentinel; the
  JS side seeds an empty allowlist). The `nil` default is
  unchanged. Same semantics now apply to `:gestures`.

### Changed

- **`imageToScreen` / `screenToImage`** on viewer + canvas handles
  now apply the rotation analytically. For 90°-snapped angles the
  cos/sin pair is exact (no float drift) and the formula reduces
  to swaps + negations. Extensions (Etcher annotations, ML
  overlays, comment threads) that route coordinate math through
  these helpers pick up rotation support without any consumer-side
  fix-ups — image-pixel coords stay invariant.
- **`fit()` / `clampPan()`** account for the rotated content's
  screen-space bounding box. A 90° rotation on a landscape image
  now fits the swapped (portrait) dims into the viewport instead
  of the original landscape dims.
- **`setTransform(tx, ty, s, rot?)`** takes an optional 4th
  argument for rotation. Three-arg callers see no behavior change
  — their rotation is preserved.

### Not supported

- **`<Fresco.scroll_strip>`** is vertical-only by design;
  `setRotation` / `rotateBy` on a strip handle are no-ops that
  warn loudly enough to catch wrong-handle bugs in development.
  `getRotation()` returns `0`.

## 0.5.6 — 2026-05-21

### Fixed

- **`<Fresco.canvas>`'s handle now re-exports `setPanBounds`,
  `setHomeAction`, and `getTransform`.** All three lived on the
  underlying controller from 0.5.2 but `makeCanvasHandle` never
  proxied them out, so consumers calling
  `handle.setHomeAction(...)`, `handle.setPanBounds(...)`, or
  `handle.getTransform()` got `undefined`.

  User-visible result before the fix: in a multi-image canvas
  (paged manga readers, lookbooks), the nav-column reset button
  and the `0` keyboard shortcut both fell through to the engine's
  default `fit()` (canvas-wide), which on a wide multi-image
  canvas zoomed out to canvas-wide scale and shoved the visible
  page to the edge. Consumers wanting "reset = re-fit current
  page" had no way to install that handler. Same gap silently
  broke per-page pan clamping (`setPanBounds(currentPage_rect)`)
  and overlay HUDs that mirror the canvas transform
  (`getTransform()`).

  The viewer handle path is unaffected — `mountFrescoViewer`
  returns its controller as the handle directly, so all three
  methods were already reachable there. Only the canvas path
  needed the proxy.

## 0.5.5 — 2026-05-21

Canvas multi-image visibility now broadcasts a signal extensions
can subscribe to. Pure-additive; existing single-image canvas
consumers see no change.

### Added

- **`image-visibility-change` event** on the canvas handle bus.
  Fires from `setImageVisible(id, visible)` whenever the hidden
  set actually changes (no-op re-toggles are silent). Payload:
  `{imageId, visible}`. Lets extensions pinned to a specific
  image — Etcher annotations, ML overlays, comment threads —
  hide or restore their DOM in lockstep with the host's
  `display: none` on that image's `<img>`.
- **`handle.getHiddenImageIds()`** returns a snapshot of the
  currently-hidden image ids as a plain array. Late-mounting
  extensions seed their initial state from this — the event is
  fire-and-forget, not replayed, so an extension that mounts
  after the host already toggled images off needs a pull API.
- **`handle.setImageVisible(id, visible)`** is now on the canvas
  handle's public surface (was previously available on the
  underlying controller only).

### Why now

Etcher 0.4.7 ships per-image shape tagging on multi-image canvases
(paged manga / spread readers / lookbooks) so it can hide shapes
whose host image is currently `display: none`. The host already
calls `setImageVisible`; this release adds the signal Etcher needs
to mirror that state.

## 0.5.4 — 2026-05-20

Strip handle's `getImages()` now reports horizontal layout and prefers
live natural dimensions, closing two extension-overlay edge cases
flagged during Etcher 0.4 strip-renderer integration. Pure-additive
on the field list; one behavior change is called out below.

### Changed

- **`handle.getImages()` on `<Fresco.scroll_strip>`** now includes
  `left` and `width` alongside the existing `top` and `height`. All
  four come from the corresponding `offsetLeft` / `offsetTop` /
  `offsetWidth` / `offsetHeight` on each `<img>` element — i.e.,
  positions are **padding-box-relative to the image's offset parent**
  (which is the scroll container, since `<Fresco.scroll_strip>` sets
  `position: relative` on the container at mount). Consumers that
  style the container with horizontal padding, or center narrower
  pages for desktop readability, can now size per-image overlays
  correctly without re-querying the DOM themselves.
- **Natural dimensions prefer the loaded bitmap.** When a strip image
  has finished loading, `getImages()` returns `img.naturalWidth /
  naturalHeight` in the `naturalWidth` / `naturalHeight` fields; the
  consumer-passed `sources[i].width` / `height` is now a fallback for
  unloaded images. Lets consumers seed `sources` with placeholder
  ratios (e.g. server-side dim probes that haven't fired yet) without
  permanently baking those ratios into extension geometry.

  > **Behavior change.** `sources` is now treated as a *hint for
  > placeholder sizing*, not a permanent override of the bitmap's
  > intrinsic dimensions. Consumers that deliberately want
  > `sources[i].width / height` to win over the loaded image
  > (synthetic renders, hard scaling overrides) will see the new
  > behavior. No code path in the official strip flow does this; the
  > flag is here in case you're one of the consumers who does.

### Why now

Etcher 0.4 ships a strip-renderer that anchors per-image SVG overlays
to each `<img>`'s offset rect and uses the natural dimensions as the
overlay's `viewBox`. With the pre-0.5.4 surface, overlays sized to
`100%` of the scroll container (so consumer-side horizontal padding
left shapes stretched off the visible image) and `viewBox` got stuck
at any placeholder ratio the consumer passed for unloaded images.
Both fixes live cleanly on the Fresco side — extensions shouldn't have
to walk the DOM to recover layout fresco already has.

## 0.5.3 — 2026-05-20

`<Fresco.scroll_strip>` now exposes the same extensions contract as
`<Fresco.canvas>`, so peer libraries (Etcher, ML overlays, comment
threads, …) can hydrate on strip-mode chapters identically to canvas
ones. Pure-additive; existing strip consumers see no change.

### Added

- **`:extensions` attr** on `<Fresco.scroll_strip>` — map, default
  `%{}`. Rendered as `data-extensions={Jason.encode!(...)}` on the
  strip host. Consumers pass annotation / overlay state through here
  the same way they do for `<Fresco.canvas>`. Empty default →
  `data-extensions` attribute is omitted; no existing markup changes.
- **`handle.getExtension(name)`** on the strip handle — returns the
  parsed `extensions[name]` blob (or `undefined` when the attribute
  is absent / unparseable). Matches the canvas handle's signature
  exactly, so peer libraries can detect "is this canvas or strip?"
  via the existing `"scrollTo" in handle` test and then call
  `getExtension` uniformly.
- **`handle.getImages()`** on the strip handle — returns a snapshot
  of the strip's images with their live rendered positions in
  scroll-container coordinates:

  ```js
  [
    { idx: 0, url: "/page-01.jpg", naturalWidth: 720, naturalHeight: 9200,
      top: 0, height: 1080, element: <img …> },
    { idx: 1, url: "/page-02.jpg", naturalWidth: 720, naturalHeight: 8800,
      top: 1080, height: 1032, element: <img …> },
    …
  ]
  ```

  Lets extensions position per-image overlay siblings without
  re-querying the DOM each scroll tick. `top` / `height` are read
  from each `<img>`'s `offsetTop` / `offsetHeight` and stay valid
  across memory-windowing evict/restore (aspect-ratio CSS holds
  the layout). The `element` field is the raw `<img>` DOM node;
  consumers attach overlay siblings via standard DOM
  (`element.parentNode.insertBefore(...)`).

### Performance note

`getImages()` forces a synchronous layout flush via `offsetTop` /
`offsetHeight`. Callers should cache the result and re-query on
resize / orientation change, not per scroll tick. The strip's
existing `viewport-change` and `scroll` events are the right
signals to drive overlay re-positioning if needed (usually not —
native browser scroll moves the overlay siblings along with the
imgs they sit next to).

### Why now

Etcher 0.3 doesn't yet support `<Fresco.scroll_strip>` (separate
Etcher work — strip-renderer module, per-shape `image_idx` binding,
gesture coordination with native scroll). When that lands, Etcher
needs a stable Fresco-side contract for hydration and per-image
layout discovery — the same surface canvas already provides.
0.5.3 puts that contract in place so the eventual Etcher port can
attach without coordinated Fresco churn.

## 0.5.2 — 2026-05-19

Nine additive consumer hooks. Cleans up the workarounds the heaviest
consumer (paged manga/manhwa reader) carries today, and adds generic
capabilities — animated transitions, memory windowing, gesture / nav
allowlists, tap events, view-tracking analytics — every Fresco consumer
benefits from. Every new API defaults to no-op / unset, so existing
call sites see identical pre-0.5.2 behavior.

### Added — runtime handle methods

Call these after `window.Fresco.onReady(id, handle => ...)`:

- **`handle.setPanBounds(rect | null)`** — clamp pan to a custom canvas-
  pixel rect (overrides `infinite_canvas`'s no-clamp when set). Pass
  `null` to revert. Wired on both viewer and canvas handles.
- **`handle.setHomeAction(fn | null)`** — override the reset nav button
  + `0`-key behavior with a custom function. Pass `null` to revert to
  the engine's default `fit()`. Wired on both handles.
- **`handle.setImageVisible(id, bool)`** (canvas only) — toggle
  individual images' visibility without changing layout. Pan-bounds,
  annotations, fit math stay anchored to the original layout.
- **`handle.setMemoryWindow(n)`** (canvas only) — programmatic
  alternative to the `:memory_window` attr. Pass an integer (viewports
  of padding) or 0/null to disable.
- **`handle.fitBounds(rect, {animate, duration, easing})`** — opt-in
  animated transition between viewport positions. Default still
  instant; animation cancels cleanly on any user gesture (pointerdown,
  wheel, dblclick) so the user's intent always wins. Easing functions:
  `"linear"`, `"ease-out"` (default), `"ease-in"`, `"ease-in-out"`.
  Wired on both handles.
- **`handle.enableViewTracking({settleMs, threshold})` /
  `handle.disableViewTracking()` / `handle.getFocusedImage()`**
  (canvas + strip) — opt-in view-tracking. Emits `view-focus` /
  `view-blur` on the bus whenever the dominant image changes. Useful
  for reading-time analytics, resume-position persistence, A/B nav
  tests. See `:view_tracking` attr below for the declarative form.

### Added — bus events

- **`tap`** — fires on non-drag pointerup. Payload:
  `{x, y, imageX, imageY, pointerType}`. Movement threshold for "no
  drag" is 5px cumulative. Centralizes tap-vs-drag detection so
  consumers don't re-roll pointer state.
- **`image-evicted` / `image-restored`** (canvas only) — paired events
  fired by the memory-windowing loop when an image's `src` is swapped
  in or out. Payload: `{imageId}`.
- **`view-focus` / `view-blur`** (canvas + strip, opt-in via
  `:view_tracking`) — paired events. `view-focus` fires when a new
  image becomes dominant; `view-blur` fires when it loses dominance.
  Payloads:
  - `view-focus`: `{imageId, previousImageId, atMs}` (previousImageId
    is `null` on the very first focus.)
  - `view-blur`: `{imageId, durationMs, atMs, reason}`. Reason is one
    of `"viewport-change"` (user navigated away), `"page-hidden"`
    (browser tab backgrounded), `"disabled"` (consumer called
    `disableViewTracking`), or `"destroyed"` (component
    unmount). Lets consumers separate "user moved on" from "user
    walked away" for time-on-page math.
  Three guarantees: every `view-focus` is eventually paired with a
  `view-blur` for the same id; blur+focus fire together on viewport-
  change (single chained pair per actual user-visible focus change);
  duration is wall-clock from focus to blur (page-visibility pauses
  emit an explicit `"page-hidden"` blur so consumers can exclude
  inactive time on their side if they want).

### Added — declarative component attrs

- **`:initial_fit_image_id`** (canvas) — land at this image's fit on
  first paint. Avoids the brief flash of "whole-canvas visible" before
  an `onReady` callback re-fits. Falls back to canvas-wide fit (with
  a `console.warn`) if the id doesn't match.
- **`:initial_fit_bounds`** (canvas) — same, for a custom rect. Map of
  `%{x:, y:, width:, height:}`. Mutually exclusive with
  `:initial_fit_image_id` (image-id wins).
- **`:memory_window`** (canvas) — auto-evict `src` for images more
  than N viewport-widths/heights from the current viewport. Same trick
  `<Fresco.scroll_strip>` uses, generalized to 2D layouts. Eviction
  recomputes throttled to every 8 animation frames. Restore happens
  automatically when an image's rect comes back into the inflated
  window.
- **`:gestures`** (viewer + canvas) — allowlist of enabled gestures:
  `[:pan, :pinch, :wheel, :double_click, :keyboard]`. Default `nil`
  enables all. Omitted entries are disabled. Useful for kiosks
  (drop `:keyboard`), swipe-paged readers handling their own taps
  (drop `:double_click`).
- **`:nav_buttons`** (viewer + canvas) — allowlist of enabled built-in
  nav buttons: `[:home, :zoom_in, :zoom_out, :fullscreen]`. Default
  `nil` enables all. Omitted entries are hidden from the rendered nav.
- **`:view_tracking`** (canvas + strip) — declarative on-switch for
  the view-tracking event channel described above. Default `false`.
  Companions: `:view_settle_ms` (default `150`, ms the new dominant
  image must hold before `view-focus` fires; filters fly-bys) and
  `:view_threshold` (default `0.5`, fraction of canvas image area
  that must intersect the viewport to count as dominant — canvas
  only). All four are inert when `:view_tracking` is off.

### Fixed

- **High-resolution images in `<Fresco.viewer>` no longer get stuck
  showing only the top-left corner.** Previously, an image with very
  large natural dimensions (e.g. 30000×20000) would render at natural
  CSS pixel size during the window between the img element appearing
  in the DOM and the engine reading `naturalWidth` + running the
  first fit. The viewer's `overflow: hidden` clipped everything
  outside the viewport, and `clampPan` had nothing meaningful to
  clamp against (iw/ih were 0), so the user couldn't pan to the
  rest. Three changes fix it together:
  - **New CSS rule** hides `.fresco-stage img` until the host has
    the `fresco--ready` class. The class flips on after the first
    successful fit (viewer + canvas) or on an image-load error.
    No more natural-size flash regardless of image size or load
    duration.
  - **Fit no longer waits on `img.decode()`.** For huge images the
    decode promise could take seconds; the engine now fits as soon
    as natural dimensions are available, then kicks off decode in
    the background for GPU readiness. Worst case: a brief blur on
    the first frame.
  - **Fit runs when `naturalWidth > 0` even if `img.complete` is
    `false`** (header bytes give us the metadata we need before
    the body finishes streaming). Re-runs on `load` if needed.
- **`error` event on the bus** when an image fails to load. The
  engine marks itself ready so pan/zoom UI doesn't lock up (the
  host shows the browser's broken-image placeholder).
- **Relaxed the `sMax` ceiling** from a 8192-px GPU layer cap to
  a 30000-px max-element-size cap. The 8192 figure was a
  rasterization safety from the 0.4.x transform-scale engine and
  artificially limited zoom on medium-large images (e.g. an
  8000-px image was capped at ~1× natural ratio instead of 8×).
  Width/height-based rendering doesn't have GPU texture limits;
  the only real ceiling is the browser's max element size, which
  is ~32767 px on all major engines.

### Engine internals

- `createTransformEngine` now accepts `zoomFloor` / `zoomCeiling` /
  `panLocked` / `gestures` / `navButtons` opts (parsed from data-attrs
  via the new internal `readConstraintAttrs` helper) so the nav
  allowlist is honored on first paint, not after a flash of the full
  button set.
- `setTransform` cancels any in-flight animation — an explicit
  `setTransform` is a "go here now" command. Use `animateTo` (or
  `fitBounds(rect, {animate: true})`) for the glide variant.

### Replaces these consumer workarounds

The paged-reader workarounds we'd been carrying for the heaviest
consumer collapse into one-liners with 0.5.2:

| Old hack | New API |
|---|---|
| `pan` event → call `fitBounds` to clamp inside the spread | `handle.setPanBounds(spread_rect)` |
| `animation` event → catch home-button bypassing the floor | `handle.setHomeAction(() => fitToCurrentPage())` |
| `dblclick` capture-phase listener to swallow Fresco's zoom | `:gestures={[:pan, :pinch, :wheel, :keyboard]}` |
| Manual `img.style.visibility = "hidden"` on neighbours | `handle.setImageVisible(neighbour_id, false)` |
| `onReady` re-fit causing a microsecond strip-visible flash | `:initial_fit_image_id="current-page"` |
| Hand-rolled drag-vs-tap in pointer handlers | `handle.on("tap", e => ...)` |
| Custom dominant-image / settle / page-visibility tracking for analytics | `:view_tracking` + `handle.on("view-focus" / "view-blur", e => ...)` |

### Unchanged

All existing handle methods, events, theming, infinite-canvas
semantics, `<Fresco.scroll_strip>`, file format, `Fresco.Canvas` API —
all untouched. Every 0.5.2 feature is additive and defaults off.

## 0.5.1 — 2026-05-19

Opt-in constraint controls on the engine: **zoom floor / zoom ceiling
overrides** and a **pan lock**. Lets consumers pin the zoom-out floor to
a logical "page" (paged readers, wallpaper croppers) and freeze pan
gestures while the user is at fit. The whole surface is additive — all
three default to no-op so existing consumers see identical pre-0.5.1
behavior.

### Why

The 0.5.0 engine computed `sMin = sFit` (clamped) or `sFit * 0.05`
(infinite_canvas) once from the canvas-natural dimensions. For paged
readers using `<Fresco.canvas>` to host every page side-by-side and
navigating via `handle.fitBounds(page_rect)`, neither default fit a
"per-page" zoom-out floor — the floor needs to be the current page's
fit-to-viewport scale, which changes as the user navigates. Same need
surfaces for single-image consumers cropping a wallpaper to a
fixed-aspect viewport.

The 0.5.0 workaround was an `animation`-event bounce-back: watch s
per-frame, snap back when it dips below the desired floor. Visibly
jitters on pinch. 0.5.1's setters give the engine a hard clamp instead.

### Added

- **`handle.setZoomFloor(scale)`** on both viewer and canvas handles.
  Overrides the engine's `sMin` until cleared. Pass a positive number
  to set, `null` / `undefined` / `0` to revert. The floor is enforced
  across all zoom paths — wheel, pinch, double-click, `fitBounds`,
  `setTransform` — so consumers can't accidentally bypass their own
  floor.
- **`handle.setZoomCeiling(scale)`** — symmetric ceiling override.
  Defaults to the engine's `min(8 × natural ratio, 8192-px raster cap)`.
- **`handle.setPanLocked(locked)`** — when `true`, single-pointer pan
  gestures (mouse drag, touch drag, arrow keys, programmatic
  `panBy`) are suppressed. Two-pointer pinch still works for zoom.
- **Component attrs** (declarative sugar): `:zoom_floor`,
  `:zoom_ceiling`, `:pan_locked` on both `<Fresco.viewer>` and
  `<Fresco.canvas>`. Render as `data-zoom-floor` / `data-zoom-ceiling`
  / `data-pan-locked` on the host; the engine reads them at mount and
  applies before the first gesture. Consumers who need to update the
  constraints at runtime (e.g. per-page in a paged reader) use the
  handle methods directly.

### Engine internals

`recomputeBounds` now reads `customSMin` / `customSMax` closure-locals
that shadow the computed defaults when set. The `panBy` and pointer-
drag pan path short-circuit when `panLocked === true`. Pinch (two
pointers) is unaffected by the lock so zoom-via-gesture still works.

### Unchanged

- All existing handle methods, events, theming, infinite-canvas
  semantics — untouched. The `<Fresco.scroll_strip>` block is unrelated
  to this change.
- No breaking changes to data layouts, file format, or
  `Fresco.Canvas`'s API.

## 0.5.0 — 2026-05-19

Full rewrite of `<Fresco.viewer>` plus a new companion component
**`<Fresco.canvas>`**. **OpenSeadragon is gone.** The viewer is now a
hand-rolled ~500-line CSS-transform pan/zoom engine, built specifically
for the manga/manhwa-reader use case where iOS Safari smoothness
matters more than tile-pyramid deep zoom. Single `<img>` lives inside
a stage div; `transform: translate3d(tx, ty, 0) scale(s)` on the stage
handles all motion. Native Pointer Events drive gestures; native
Fullscreen API handles fullscreen. Zero external JS deps, no CDN load.

`<Fresco.canvas>` is the new layered scene primitive: N images at
absolute canvas-pixel coordinates plus an open `extensions` map for
annotation tools ([Etcher](https://hex.pm/packages/etcher)), ML
overlays, and other peer packages. Serializes to a single `.fresco`
JSON file so an entire scene lives in one place instead of scattered
DB tables. Single-image is just the N=1 case. Shares the new
CSS-transform engine with the viewer — same gestures, same smoothness,
same `infinite_canvas` / `theme` semantics.

`<Fresco.scroll_strip>` is unchanged — it was already lite (native DOM
`<img>` + browser scroll, no canvas).

### Why a rewrite, not a tweak

OSD shipped ~150 KB of canvas-redraw machinery for a problem the library
no longer prioritizes. The `pan_optimized` fast path in 0.3.x was a
workaround for the same root cause that's gone now: no canvas, no spring
math, no per-frame redraw. Pan and zoom are a single GPU-composited
transform on a stage div. Pinch on iOS works because PointerEvents handle
two-pointer gestures natively — no OSD touch shim in the way.

### Added — `<Fresco.canvas>` component

- **`Fresco.Canvas` Elixir module** — `defstruct` (`version`, `canvas`,
  `images`, `extensions`, `__extra__`), builders (`new/1`, `add_image/2`,
  `put_extension/3`), JSON I/O (`to_json/1`, `to_json!/1`, `from_json/1`,
  `from_json!/1`), atomic file I/O (`write/2`, `write!/2`, `read/1`,
  `read!/1`). Atomic writes go through `<path>.tmp` then rename, so an
  interrupted save can't corrupt the existing file.
- **`Fresco.Canvas.SchemaError`** — structured exception with `:path`
  (list of atoms/indices pointing at the offending field) and `:reason`
  (matchable term, e.g. `{:expected_positive_number, -3}`,
  `{:duplicate_id, "img-1"}`).
- **`<Fresco.canvas>` Phoenix.Component** — attrs: `:id` (required),
  `:canvas` (required `%Fresco.Canvas{}` struct), `:class`,
  `:infinite_canvas`, `:theme`, `:rest`. Renders host > stage > N
  positioned `<img>` tags. Each img carries `data-canvas-x/-y/-width`
  and optionally `-height` / `-z-index` so the JS engine can re-layout
  per frame.
- **New JS hook `FrescoCanvas`** in `priv/static/fresco.js`. Reuses
  every shared helper (`createEventBus`, `attachNavButton`,
  `injectStyles`, `ICONS`, `buildNav`, registry) and the new internal
  `createTransformEngine`. Adds `mountFrescoCanvas` for N-image layout
  and `makeCanvasHandle` for the extended handle surface.
- **Canvas handle additions** beyond the viewer handle:
  `getCanvasSize()`, `getImages()`, `imageBoundsFor(id)`, `fitImage(id)`,
  `getExtension(name)`. `imageToScreen` / `screenToImage` operate in
  **canvas-pixel coords** — the same coord system the `.fresco` file
  uses, so annotation payloads compose uniformly.
- **`.fresco` file format (v1)** — see `Fresco.Canvas` moduledoc.
  Forward-compat is built in: unknown top-level and per-image keys are
  preserved via a private `__extra__` map and re-merged on `to_json`,
  so a v1 reader of a future v2 file round-trips v2 fields verbatim.
  Same rule applies inside `extensions.*` blobs (opaque to Fresco).
- **Three-way component facade** — `Fresco.canvas/1` joins `viewer/1`
  and `scroll_strip/1` as a `defdelegate` on the `Fresco` module.

### Internal refactor (no behavior change for the viewer)

- **`createTransformEngine({el, stage, getNaturalSize, applyChildren,
  infiniteCanvas})`** — shared pan/zoom/clamp/gesture pipeline used by
  both `mountFrescoViewer` and `mountFrescoCanvas`. The viewer passes
  `getNaturalSize = () => ({w: img.naturalWidth, h: img.naturalHeight})`
  and `applyChildren = (s) => { img.style.width = (iw*s)+"px"; ... }`;
  the canvas passes `getNaturalSize = () => ({w: canvas-width, h:
  canvas-height})` and `applyChildren = (s) => { for each img: ... }`.
  All existing viewer tests pass unchanged.

### Extension contract — passive Fresco

Fresco is passive with respect to `extensions`. Updates flow consumer
LiveView → `%Fresco.Canvas{}` in assigns → re-render. A peer package
like Etcher reads its initial state via `handle.getExtension("etcher")`
at mount, pushes annotation edits to its own LiveView, which calls
`Fresco.Canvas.put_extension(canvas, "etcher", new_data)` and
re-assigns. Fresco's handle is intentionally read-only for extensions
— no `setExtension` method exists, so save timing never races with
annotation updates across channels. The `.fresco` file is the single
source of truth.

### Removed

- **OpenSeadragon.** The library no longer fetches or wraps it.
- **`handle.openSeadragon` / `handle.viewer`** (the escape hatch into OSD).
  No shim — overlays that reached into OSD must migrate to coordinate
  adapters and event hooks.
- **`:sources` attr** — single-source only in 0.5. A future minor version
  may reintroduce multi-image layout as an additive attr.
- **`:rotate` attr** — additive comeback later.
- **`:pan_optimized` attr and the `fast-pan` event** — unnecessary now;
  the lite engine is always CSS-transform-based.
- **DZI / tile-source support** via the default
  `registerSourceProvider` flow. The registry still exists (and a future
  Tessera update will use it), but plain image sources are the only
  `type` the bundled engine knows. Other types throw a clear error.

### Kept (compatible surface)

- **`<Fresco.viewer id src class infinite_canvas theme>`** — same call
  sites work. `src` is now required (was optional, falling back to
  `:sources`).
- **`window.Fresco.{viewerFor, scrollStripFor, onViewerReady, onReady, registerSourceProvider}`**.
- **Viewer handle**: `container`, `imageToScreen`, `screenToImage`,
  `getViewportBounds`, `fitBounds`, `setSource`,
  `swapSourcePreservingBounds`, `on`, `_emit`, `appendNavButton`.
  Coordinates return page-space, matching 0.4.x.
- **Events**: `zoom`, `pan`, `open`, `resize`, `animation`,
  `update-viewport`. Semantics are equivalent — `zoom`/`pan` fire on
  gesture intent; `animation`/`update-viewport` fire on every transform
  write.
- **All `<Fresco.scroll_strip>` behavior** — strip mode is unchanged.
- **Six `--fresco-*` CSS custom properties** + four theme modes.

### Changed semantics

- **`handle.getViewportBounds()`** now returns image-pixel coordinates
  `{x, y, width, height}` directly. 0.4.x returned OSD's normalized
  0–1 viewport rect (`OpenSeadragon.Rect`). Image-pixel coords are
  what overlay code was converting to anyway, but this is a breaking
  change for any consumer that was using the normalized form raw.
- **`handle.fitBounds(rect, immediately)`** accepts an image-pixel rect.
  The `immediately` flag is preserved for API compatibility but ignored
  — 0.5.x has no animation system.

### Intentionally cut from this release

- **Momentum / inertia.** Skipped to ship fast. CSS-transform pan is
  already smooth *during* the gesture; momentum is the post-release
  glide. May come back in a later 0.x.
- **Multi-image layout (`:sources`).** Can come back as an additive
  attr.
- **Rotation (`:rotate`).** Trivial to add back in the transform string.
- **Tile-source providers other than "image".** The registry hook is in
  place; Tessera-lite (when it lands) will register a `{type: "tiles", …}`
  factory and the engine will switch on the `type` field.

### Migration notes

- Callers passing `:sources`, `:rotate`, or `:pan_optimized` will get
  compile warnings (`Phoenix.Component` strict-attrs). Remove the
  attrs; for `:sources`, fall back to a single `:src` for now.
- Code reaching into `handle.openSeadragon` must be ported off to use
  `imageToScreen` / `screenToImage` / `on(...)`. Annotation-style
  overlays can also attach as children of `.fresco-stage` to inherit
  the transform automatically, with no per-frame coordinate math.
- Existing `tessera` (DZI) and (planned) `etcher` releases need
  updates to track this version. Pin to `fresco ~> 0.4` until those
  updates land if you depend on either.

### Notes

- Etcher 0.3+ ships in a separate package release and is the
  reference consumer for `getExtension` / `imageBoundsFor` /
  `getImages`. Fresco 0.5 doesn't depend on it.
- Memory windowing for very large multi-image canvases (>10 images)
  is deferred until a real call site needs it. The strip's
  evict/restore trick doesn't map cleanly because canvas images can
  be anywhere; a viewport-overlap heuristic will be added when
  needed.

## 0.4.0 — 2026-05-18

New sibling component for long-scroll reading content:
**`<Fresco.scroll_strip>`**. Native DOM `<img>` + browser scroll, no
OpenSeadragon, no per-frame JS, native 60fps on iOS Safari for
manhwa / long comics / IG-style feeds. Existing `<Fresco.viewer>`
is untouched — strip mode is an *additional* primitive for a
different shape of content.

The architectural rationale: `<Fresco.viewer>` (OSD-backed) is
correct for deep-zoom imagery and wrong for vertical-image-strip
reading. OSD redraws the canvas per pan frame; the `pan_optimized`
fast-path partially helps but fails on large snaps that move
beyond the painted viewport area ("half-render then POP"). Native
browser scroll on DOM `<img>` is GPU-composited and effectively
free per frame. Strip mode delivers exactly that, plus memory
windowing so a long chapter doesn't pin hundreds of MB of
decoded-image pixels.

### Added

- **New Phoenix.Component `Fresco.ScrollStrip`** (`<Fresco.scroll_strip>`).
  Attrs: `:id`, `:sources` (list of `%{url, width, height}` maps,
  `:width` + `:height` mandatory), `:class`, `:theme`,
  `:window_before` (default `1`), `:window_after` (default `3`),
  `:gap_px` (default `0`), `:snap_to_image` (default `:off`,
  values `[:off, :mandatory, :proximity]`).
- **New JS hook `FrescoScrollStrip`** in `priv/static/fresco.js`.
  Wires the scroll bridge (rAF-coalesced), the memory-windowing
  loop (evict `src` outside `[current - window_before, current +
  window_after]`; restore on re-entry; CSS `aspect-ratio` keeps
  the layout stable through both), and the handle registry. Also
  routes `phx:scroll-to` from the consumer's LiveView straight to
  `handle.scrollTo/1` for chapter-resume / programmatic snap use
  cases.
- **New strip handle** with surface: `container`, `on`, `_emit`,
  `appendNavButton` (shared with the viewer handle via lifted
  helpers); plus strip-specific `scrollTo({imageIdx, y, behavior})`,
  `scrollBy({dy, behavior})`, `imageToScreen({imageIdx, x, y})`,
  `screenToImage({x, y}) → {imageIdx, x, y}`, and
  `getScrollState()`. Events: `scroll`, `viewport-change`,
  `image-loaded`, `image-evicted`, `open` — emitted only when an
  actual change happens (e.g., `viewport-change` doesn't fire on
  every scroll tick, only when the dominant image index changes).
- **New registry lookups** `Fresco.scrollStripFor(domId)` (alias
  of `viewerFor` for ergonomic consumer code) and `Fresco.onReady`
  (alias of `onViewerReady`). Both share the existing registry —
  same handle store, same queue, same semantics.
- **`handle.openSeadragon` on strip handles is a throwing getter**.
  Strip mode has no OSD; accessing it from an overlay usually
  means the overlay was written for the viewer host without a
  renderer adapter. The thrown error message points at the fix
  (feature-detect via `"scrollTo" in handle`).

### Changed (internal refactor; no behavior change for viewer
consumers)

- **Extracted `createEventBus()` helper.** Both the viewer handle
  (`makeHandle`) and the new strip handle (`makeStripHandle`)
  return the same `on(name, fn) → unsubscribe` channel and the
  same internal `_emit(name, payload)`. Pulling the closure-based
  event-emitter out keeps both factories in sync.
- **Extracted `attachNavButton(navEl, svg, title, onClick)` helper.**
  Same body the viewer's `appendNavButton` had inline; lifted so
  the strip handle reuses it without code duplication. When
  `navEl` is null (strip's default — no built-in nav), returns a
  no-op unsubscribe so callers can call `appendNavButton`
  unconditionally.

### Notes

- **Strip mode ships with no built-in nav.** Strip is meant to be
  minimal — consumers who want a fullscreen button or
  scroll-to-top affordance add them via
  `handle.appendNavButton(...)`. The viewer's zoom-in/out/reset/
  fullscreen overlay doesn't apply (no zoom; "reset view" has no
  meaning when natural scroll position is the only state).
- **No breaking changes for existing consumers.** All viewer
  attrs, events, the OSD escape hatch, `pan_optimized`, the
  `fast-pan` event — all unchanged. The internal refactor (event
  bus + nav-button helpers) is purely structural; the surfaces
  match what 0.3.x emitted.
- **Etcher >= 0.3 is required for annotations on strip mode.**
  Etcher 0.2 paired with a strip handle will hit the throwing
  `openSeadragon` getter and fail loudly — by design (silent
  drift would be worse). Etcher 0.3 ships a renderer adapter
  that feature-detects via `"scrollTo" in handle` and dispatches
  to a strip-positioning module. Annotations on the viewer host
  continue to work with Etcher 0.2 or 0.3.
- **No horizontal strip yet.** Most "horizontal" image
  consumption (manga RTL, IG carousels) is paginated rather than
  continuous-scroll, so true horizontal continuous scroll is
  rare. The handle API uses object payloads (`{imageIdx, y}`,
  `{x, y}`) so a future `Fresco.scroll_strip_h` is a sibling
  component, not a breaking change here.

## 0.3.2 — 2026-05-17

Fix `:pan_optimized` getting stuck for any caller that pans with
`immediately=true` (touch drag, wheel scroll, custom per-rAF
`panBy(delta, true)` loops). Those callers fire `pan` events but
never `animation` / `animation-finish` — the 0.3.1 fast-pan
installer engaged anyway and waited on a commit signal that
never arrived, leaving OSD's drawer suppressed indefinitely. The
user would see stale tiles until the next spring-based pan
flushed the state.

### Fixed

- `installFastPan` now skips `pan` events with `e.immediately ===
  true`. Immediate panners are already snappy (no spring redraw
  cycle to skip) — the fast path's win is specifically for spring
  momentum / programmatic `panTo(target, false)`, which is the
  slow case on iOS. Native OSD handles the immediate case
  directly.
- Added a 1-second watchdog timer as defensive backup. Armed when
  fast-pan starts, re-armed on every spring tick, cleared on
  commit. If no animation events arrive within the window
  (e.g., a custom OSD plugin or a future OSD release pans through
  an unfamiliar code path), the watchdog fires `commitFastPan`
  with a `console.warn` so the drawer can't stay suppressed
  forever. Belt-and-suspenders to the `immediately`-skip above.

### Notes

- No public API changes. `:pan_optimized` attr and `fast-pan`
  event surface identical to 0.3.0/0.3.1. Etcher 0.2.8's listener
  continues to work unchanged.
- Consumers driving their own per-rAF inertia loops (calling
  `panBy(delta, true)` each frame) will now correctly skip
  fast-pan — `pan_optimized={true}` is effectively a no-op for
  that motion shape, by design. Switch your snap to
  `panTo(target, false)` (spring-driven) to actually engage the
  fast path.

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
