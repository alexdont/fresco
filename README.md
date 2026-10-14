# Fresco

Polished pan-zoom image viewer for Phoenix apps. The foundation for layered image experiences (annotations, progressive quality, ML overlays) — also useful standalone whenever you just need a *good* image viewer.

A *fresco* is the wet-plaster surface you paint on. Fresco the library is the surface every layered image experience sits on top of: extensions attach to the same viewer instance via a small extension API. Used alone, it's still a complete viewer with pan, zoom, rotation, fit-to-view, a nav that fits a phone, and viewport clamping.

---

## How it works

Fresco is its own small pan/zoom engine — **no OpenSeadragon, no `<canvas>` element, no external JavaScript**. (Versions before 0.5.0 were built on OpenSeadragon; 0.5.0 replaced it. See the CHANGELOG.)

- The picture is an ordinary `<img>` inside a *stage* element. Pan, zoom and rotation are one CSS `transform` on the stage (`translate3d(…) rotate(…)`), and the image is sized for the current scale — so moving around is a GPU-composited transform, smooth on iOS Safari, with no per-frame redraw.
- Input comes straight from the browser: Pointer Events for drags and pinches, wheel events for mouse wheels, trackpads and trackpad pinches, the keyboard, and the native Fullscreen API.
- `<Fresco.canvas>` is the same engine with N images laid out at canvas-pixel coordinates, plus an open `extensions` map that peer packages (like [Etcher](https://hex.pm/packages/etcher)) keep their data in. A scene serializes to one `.fresco` JSON document.
- Everything is in `priv/static/fresco.js`; nothing is fetched from a CDN at runtime.

---

## Install

```elixir
def deps do
  [
    {:fresco, "~> 0.13"}
  ]
end
```

Then in your `assets/js/app.js`, import the JS hooks and spread them into your LiveSocket hooks:

```js
import "../../deps/fresco/priv/static/fresco.js"

let liveSocket = new LiveSocket("/live", Socket, {
  hooks: { ...window.FrescoHooks, ...colocatedHooks }
})
```

The hooks are `FrescoViewer` (for `<Fresco.viewer>`) and `FrescoCanvas` (for `<Fresco.canvas>`) — if you maintain an explicit hooks map instead of spreading `window.FrescoHooks`, register both.

---

## Use it standalone

```heex
<Fresco.viewer
  id="photo"
  src={~p"/uploads/photo.jpg"}
  class="w-full h-[80vh] rounded"
/>
```

You get:

- **Pan**: click-drag, middle-drag, touch-drag, two fingers on a trackpad, keyboard arrows. Middle-drag
  works even where the left button is spoken for — an overlay's drawing tool
  or marquee selection, or `pan_locked` — so there's always a way to move
  around without switching tools.
- **Zoom**: mouse wheel, pinch (touch or trackpad), ctrl/⌘ + scroll, double-click, nav buttons, `+` / `-` keys. A double-click (or double-tap) zooms in on that spot and, from anywhere zoomed in, back out to the fitted view.
- **Rotation** in quarter turns, from the nav or the handle, optionally persisted (see [Rotation](#rotation)).
- **Fit-to-view** initial state regardless of image / container aspect ratio
- **Nav overlay** (Heroicons): zoom in / zoom out / rotate / reset view / fullscreen — a column by default, or a short row that fits a phone (see [The nav on small screens](#the-nav-on-small-screens)).
- **Viewport clamped** so the image can't be panned off-screen (unless you opt into [infinite canvas](#infinite-canvas))
- **Subtle dot-grid background** on the viewer container (Figma/Miro style); shows through any padding around the image and lights up the void in `infinite_canvas` mode.
- **Light / dark / system themes**, or inherit your app's palette (see [Theming](#theming-light--dark--system--inherit)).

---

## Infinite canvas

Opt-in mode that unclamps the viewer — the user can pan past the image edges into surrounding empty space and zoom out until the image is a thumbnail in the middle of a vast canvas. Useful when a layered overlay (e.g. [Etcher](https://hex.pm/packages/etcher) annotations) needs to draw shapes, callouts, or labels in the white space next to the image, Figma / Miro / Excalidraw style.

```heex
<Fresco.viewer
  id="photo"
  src={~p"/uploads/photo.jpg"}
  class="w-full h-[80vh] rounded"
  infinite_canvas
/>
```

What changes when `infinite_canvas` is on:

- The image can be panned fully off-screen — pan is no longer clamped to keep it in view.
- The zoom-out floor drops to 5% of the fitted scale, so the image can shrink to a thumbnail.
- The dot-grid background shows in the void around the image, and the host div picks up a `.fresco-viewer--infinite` modifier class for infinite-mode-only styling.

The reset-view button still returns to "image fits viewport" — the image stays the anchor point, just no longer the cage. Default is `infinite_canvas={false}`, so every existing viewer keeps the stock clamped behavior with no template changes required.

---

## Multiple images on one canvas — `<Fresco.canvas>`

`<Fresco.canvas>` lays any number of images out on one surface, at canvas-pixel coordinates, with the same gestures as the viewer. The scene is a `Fresco.Canvas` struct — images plus an `extensions` map for peer packages — that serializes to a single `.fresco` JSON document.

```elixir
canvas =
  Fresco.Canvas.new(width: 2000, height: 1200)
  |> Fresco.Canvas.add_image(%{src: "/uploads/a.jpg", x: 0, y: 0, width: 900})
  |> Fresco.Canvas.add_image(%{src: "/uploads/b.jpg", x: 1000, y: 0, width: 900})
```

```heex
<Fresco.canvas id="board" canvas={canvas} class="w-full h-[80vh] rounded" infinite_canvas />
```

- Height can be left out: it comes from each image's natural aspect ratio.
- `handle.imageToScreen` / `screenToImage` work in canvas pixels, so an overlay addresses every image in the same space.
- Single-image is just the N = 1 case; `<Fresco.viewer>` remains the simpler component for one picture.

### Swapping the image set in place — `handle.setSources`

On a `<Fresco.canvas>`, `handle.setSources(sources, opts)` replaces the entire image set **without remounting the DOM** — so state tied to the page session survives the swap: an engaged **Pointer Lock**, an audio/video pipeline, and peer overlays bound via `handle.on(...)`. It's the in-place alternative to `window.location.href = …`; paged readers use it for instant chapter transitions.

```js
const handle = window.Fresco.viewerFor("reader");
await handle.setSources(nextChapter.images, {
  reset_view: true,                                   // fit-to-canvas after swap (default)
  extensions: { etcher: { annotations: nextChapter.shapes } }, // optional, replaced atomically
});
// state that would die on a full navigation (Pointer Lock, etc.) is still alive
history.pushState({}, "", nextChapter.url);
```

- `sources` — array of `{ src, x?, y?, width?, height?, id?, z_index? }` (the `getImages()` shape). `w`/`h` are accepted as aliases for `width`/`height`.
- `opts.reset_view` — `true` (default) fits to the new canvas; `false` keeps the current pan/zoom (clamped to the new bounds).
- `opts.extensions` — replaces the canvas-level extension map **atomically** with the swap (e.g. `extensions.etcher.annotations`). Omitted → the current map is left untouched.
- `opts.canvasWidth` / `opts.canvasHeight` — explicit canvas extent; omitted → the new images' bounding box.
- Returns a **Promise** that resolves **after the first post-swap frame paints** (the new images are positioned/sized), so `imageBoundsFor(...)` / `getBoundingClientRect()` return measurable rects on the next line; **rejects** on empty/malformed input so you can fall back to a full navigation.
- **Resets the hidden-image set** — new images don't inherit a previous set's `setImageVisible(id, false)` bookkeeping. To preserve it, snapshot `handle.getHiddenImageIds()` before the swap and re-apply after.
- Fires `open` and a dedicated `sources-changed` event so overlays bound to them rebuild. It's programmatic-only (no "user did this" event) — you own URL history, server notification, and persistence.
- Replace-everything by design: it doesn't diff old vs new (re-setting identical `src`s hits the browser cache). Canvas-only; the single-image viewer keeps `setSource` / `swapSourcePreservingBounds`.

#### Per-image helpers for paged readers

A reader that shows one page at a time and cycles a "load window" of in-flight images pairs `setSources` with:

- **`handle.setImageVisible(id, visible)`** — toggle one image without removing it from the layout. The inline visibility flips **synchronously**, so a `getBoundingClientRect` / `imageBoundsFor` read on the next line sees the new state.
- **`handle.setImageSrc(id, url)`** — swap a single image's `src` (real URL ↔ placeholder) without a full relayout; re-latches load tracking so `image-loaded` fires on the new source.
- **`handle.whenLayoutSettled()`** — a Promise that resolves once the next frame has painted, for measuring between those mutations (`setSources` already resolves on this gate).

```js
// navigate to page N within the loaded chapter
handle.setImageSrc("page-" + n, pageMeta.url);   // swap placeholder → real
handle.setImageVisible("page-" + cur, false);    // hide the old page
handle.setImageVisible("page-" + n, true);       // show the new one (synchronous)
handle.fitBounds(handle.imageBoundsFor("page-" + n));  // measures correctly now
```

---

## Long-scroll reading — `fresco_strip`

For reading by scrolling through a stack of full-width images (manhwa, long comics, feeds), use the sibling package [`fresco_strip`](https://hex.pm/packages/fresco_strip): native browser scroll over DOM `<img>`s with memory windowing, no zoom. It was `<Fresco.scroll_strip>` until it moved into its own package; it registers its handles in the same `window.Fresco` registry, so `onReady` works for both.

---

## Rotation

Quarter-turn rotation is built in. The nav carries a clockwise button (`:rotate`) and its counter-clockwise twin (`:rotate_left`); choose which show with `:nav_buttons`. Rotation is tracked separately from zoom and pan: reset view re-fits the picture and returns it to its mount-time angle (`initial_rotation`), and a double-click zooms back out without touching the rotation.

```heex
<Fresco.viewer
  id="photo"
  src={~p"/uploads/photo.jpg"}
  class="w-full h-[80vh] rounded"
  initial_rotation={@photo.rotation}
  persist_rotation
/>
```

- `:initial_rotation` (0 / 90 / 180 / 270) paints the first frame already rotated — no flash of the unrotated picture.
- `:persist_rotation` pushes a `"fresco:rotate"` event (`%{"id", "rotation", "previous"}`) to the owning LiveView on every change, so you can save it.
- From JS: `handle.setRotation(deg)`, `handle.rotateBy(±90)`, `handle.rotateRight()`, `handle.rotateLeft()`, `handle.getRotation()`.

---

## Real pixels — `actual_size`

By default a picture is fitted to the viewer, however big or small it is. A photo app does something better, and `actual_size` turns it on:

- **100% means one image pixel per physical screen pixel.** On a 2× (Retina) display that is half a CSS pixel, so 100% really does line the picture's pixels up with the screen's.
- **A picture opens at fit or at 100%, whichever is smaller.** A 4K photo on a laptop opens fitted (and reads something like 23%); a 50×50 icon opens at its real size, small and sharp, instead of blown up and blurred to fill the view. You can still zoom it in. Reset view, a double tap's way back out, and the swipe's "fully zoomed out" all mean that opening view.
- **An "actual size" button** — a magnifier with a 1 — sits between zoom out and zoom in (− 1 +). It goes to 100%, and from 100% to fit. The `1` key does the same.
- **The zoom control** sits in the bottom-right corner and always shows the percentage. Hover it with a mouse, or tap it, and a slider opens to its left. It has detents at 50%, 100%, 150%, 200% and 400%: they are spaced evenly along the slider whatever lies between them, so the stretch from 200% to 400% at the far end runs fast, and the thumb sticks at each one for a few pixels of travel before moving on (with a buzz, on a phone that has one). It runs from the zoom-out floor to 400%, or to the zoom ceiling if that is lower. Arrow keys nudge it; Page Up / Page Down go detent to detent.
- **Bottom chrome of your own?** Lift the control clear of it with `--fresco-zoom-bottom` (and `--fresco-zoom-right`) on the viewer element. Etcher does this itself while its tool bar fills a phone's bottom edge.

```heex
<Fresco.viewer id="photo" src={@url} actual_size />
```

100% is measured in natural pixels for `<Fresco.viewer>` and in canvas units for `<Fresco.canvas>` — so lay a canvas out in the source image's own pixels (an image `width` equal to the file's width), even while a smaller copy is what loads, and the numbers read true. `handle.getZoomPercent()` reads it; `handle.toggleActualSize()`, `handle.zoomToActualSize()` and `handle.fitToView()` drive it; and the `zoom` event carries `percent` alongside `scale`.

---

## The nav on small screens

A column of buttons down the left edge is fine on a desktop and runs most of the way down a phone's picture. Fresco gives you a few dials:

- **`nav_layout: :row`** — the buttons line up along the top instead.
- **It always fits.** In either layout, buttons that don't fit move behind a "more" (⋯) button at the end and come back when there's room — a phone turned sideways, a split view dragged wider. Built-ins give up their place in this order: fullscreen, rotate left, rotate right, actual size, zoom out, zoom in, reset view. Buttons an extension added never move.
- **`nav_overflow`** — built-ins that always live behind ⋯, for a short row of the basics: `nav_overflow={[:fullscreen, :rotate_left, :home]}`.
- **`nav_reverse`** — with a row, mirror it: the first buttons sit nearest the middle of the viewer and ⋯ out in the corner.
- **`--fresco-nav-reserve-end`** — a CSS custom property, set on any ancestor, for how much of the top edge your own chrome takes at the far end (a close button, say). The row stops short of it.

```heex
<Fresco.canvas id="board" canvas={@canvas} nav_layout={:row} nav_reverse nav_overflow={[:fullscreen, :home]} />
```

---

## Gestures and events worth knowing

- **Two fingers on a trackpad pan** the picture the way they move a page's content: on a trackpad that scrolls naturally (a Mac's default), the picture follows the fingers, as if you were holding it. The browser reports them after the OS's own scroll-direction setting, so no default suits every laptop: `invert_two_finger_pan` (or `handle.setTwoFingerPanInverted(true)`) flips it — typically fed from a per-user preference.
- **Swipe between pictures.** A one-finger swipe across a picture at its fitted view (its opening view, under `actual_size`) fires `swipe` (`%{direction: "left" | "right"}`) on the handle and a bubbling `fresco:swipe` DOM event on the viewer element — your cue to show the next or previous one. Zoomed in, the same drag is a pan and is never announced. Touch and pen only.
- **`:gestures`** is an allowlist (`[:pan, :pinch, :wheel, :double_click, :keyboard, :swipe]`) for hosts that want fewer.
- **`pan_locked`** frees the left drag for something else (a drawing tool) while middle-drag, pinch and two-finger pan still move the view.

---

## Theming (light / dark / system / inherit)

Fresco ships with light + dark palettes for the viewer host background, dot grid, and nav buttons. Pass `:theme` to pick one:

```heex
<Fresco.viewer
  id="photo"
  src={~p"/uploads/photo.jpg"}
  class="w-full h-[80vh] rounded"
  theme={:system}
/>
```

- `:system` (default) — follow the OS / browser `prefers-color-scheme`.
- `:light` — force light palette regardless of OS preference.
- `:dark` — force dark palette regardless of OS preference.
- `:inherit` — emit only the host structure; the parent app's CSS supplies the palette. Use this to follow a parent theme system (see below).

> **Heads up:** `:system` is the default since `0.1.4`. Viewers on dark-OS machines render dark out of the box. Pass `theme={:light}` to lock the old always-light look.

Theming is implemented as CSS custom properties on `.fresco-viewer`:

| Variable | Purpose |
|---|---|
| `--fresco-bg` | Host background color |
| `--fresco-grid-dot` | Dot grid color |
| `--fresco-nav-bg` | Nav button background |
| `--fresco-nav-bg-hover` | Nav button hover background |
| `--fresco-nav-fg` | Nav button icon color |
| `--fresco-nav-focus` | Focus-ring color |

### Integrating with a parent theme system

Pass `theme={:inherit}` and define the six `--fresco-*` variables on `.fresco-viewer[data-fresco-theme="inherit"]` in your own CSS. Fresco skips its own var declarations for inherit-mode viewers, so the parent's values land directly. The mapping is open-ended — wire each `--fresco-*` to whatever your design system exposes (CSS custom properties, fixed colors, theme tokens, anything that resolves to a CSS color).

```heex
<Fresco.viewer
  id="photo"
  src={~p"/uploads/photo.jpg"}
  class="w-full h-[80vh] rounded"
  theme={:inherit}
/>
```

**Example: daisyUI tokens.** Each `--fresco-*` maps to a daisyUI theme token; flipping daisyUI's `data-theme` on `<html>` flips Fresco's palette automatically.

```css
.fresco-viewer[data-fresco-theme="inherit"] {
  --fresco-bg: var(--color-base-100);
  --fresco-grid-dot: var(--color-base-300);
  --fresco-nav-bg: var(--color-neutral);
  --fresco-nav-bg-hover: var(--color-base-content);
  --fresco-nav-fg: var(--color-neutral-content);
  --fresco-nav-focus: var(--color-primary);
}
```

**Example: bare colors.** No design system required — just pin each `--fresco-*` to whatever you want. Useful if you only have one viewer or want a one-off palette.

```css
.fresco-viewer[data-fresco-theme="inherit"] {
  --fresco-bg: #1a1a2e;
  --fresco-grid-dot: rgba(255, 255, 255, 0.08);
  --fresco-nav-bg: #16213e;
  --fresco-nav-bg-hover: #0f3460;
  --fresco-nav-fg: #e94560;
  --fresco-nav-focus: #f8b400;
}
```

The `[data-fresco-theme="inherit"]` selector matches Fresco's other theme branches at specificity 20, so any override at this selector always wins.

---

## Use it as a foundation for extensions

Fresco publishes each live viewer to `window.Fresco.viewerFor(domId)`. Peer libraries ([Etcher](https://hex.pm/packages/etcher) for annotations, [Tessera](https://hex.pm/packages/tessera) for progressive quality, etc.) look up the handle and attach without forking the viewer.

```js
// In another LiveView hook on the same page:
window.Fresco.onViewerReady("photo", function(handle) {
  // Coordinate adapters
  handle.imageToScreen({x: 100, y: 50});
  handle.screenToImage({x: 800, y: 400});

  // Viewport
  handle.getViewportBounds();
  handle.fitBounds(rect, /* immediately */ true);

  // Swap the source while preserving the user's zoom/pan
  handle.swapSourcePreservingBounds("/path/to/new-source");

  // Subscribe to viewer events
  const unsub = handle.on("zoom", function(e) { /* … */ });
});
```

### Adding nav buttons

`handle.appendNavButton(svg, title, onClick, opts)` adds a button to the viewer's nav and returns a remover (with `.setIcon`, `.setTitle` and `.el`). Pass `{ slot: n }` to put it at the start of the nav instead of the end, ordered by slot — so an extension's main control leads the row whichever script attached first. Etcher's pencil, style-panel switch and eye use slots 0, 1 and 2.

### Source providers

Override how Fresco treats a source URL for specific patterns. The factory returns a source descriptor; the engine renders `{type: "image", url}` (an ordinary image), which is also the default for every URL:

```js
window.Fresco.registerSourceProvider(
  function(url) { return url.startsWith("/private/"); },
  function(url) { return { type: "image", url: url + "?signed=" + token }; }
);
```

Any other `type` throws a clear error rather than failing silently — the engine draws images, not tile pyramids.

---

## Family of packages

Fresco is the foundation. Related published packages:

- **[`etcher`](https://hex.pm/packages/etcher)** — annotation and markup tools (shapes, arrows, callouts, text, freehand) drawn on a `<Fresco.canvas>`; annotations live in the canvas's `extensions` map.
- **[`tessera`](https://hex.pm/packages/tessera)** — multi-resolution, progressive-quality layer: swaps to sharper sources as the user zooms in. See its README for tiling.
- **[`fresco_strip`](https://hex.pm/packages/fresco_strip)** — long-scroll reading over a stack of images.

You can use Fresco entirely on its own; you don't need any of the related packages.

---

## License

MIT — see [LICENSE](./LICENSE).
