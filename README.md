# Fresco

Polished pan-zoom image viewer for Phoenix apps. The foundation for layered image experiences (deep zoom, annotations, ML overlays) — also useful standalone whenever you just need a *good* image viewer.

A *fresco* is the wet-plaster surface you paint on. Fresco the library is the surface every layered image experience sits on top of: extensions attach to the same viewer instance via a small extension API. Used alone, it's still a complete viewer with pan, zoom, fit-to-view, Heroicons nav, viewport clamping, and smooth animations.

---

## Install

```elixir
def deps do
  [
    {:fresco, "~> 0.1"}
  ]
end
```

Then in your `assets/js/app.js`, import the JS hook and spread it into your LiveSocket hooks:

```js
import "../../deps/fresco/priv/static/fresco.js"

let liveSocket = new LiveSocket("/live", Socket, {
  hooks: { ...window.FrescoHooks, ...colocatedHooks }
})
```

The hook name is `FrescoViewer` — if you maintain an explicit hooks map instead of spreading `window.FrescoHooks`, register it as `{ FrescoViewer: window.FrescoHooks.FrescoViewer }`.

OpenSeadragon is lazy-loaded from jsDelivr on first viewer mount — no extra `<script>` tags needed.

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

- **Pan**: click-drag, touch-drag, keyboard arrows
- **Zoom**: mouse wheel, pinch, double-click, dedicated buttons, `+` / `-` keys
- **Fit-to-view** initial state regardless of image / container aspect ratio
- **Heroicons nav overlay**: zoom-in / zoom-out / reset / fullscreen
- **Viewport clamped** so the image can't be panned off-screen
- **Subtle dot-grid background** on the viewer container (Figma/Miro style); shows through any padding around the image and lights up the void in `infinite_canvas` mode. Override `.fresco-viewer` in your own CSS for dark mode or a different accent.
- **Smooth animations** tuned snappy-but-not-jarring

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

- `visibilityRatio` drops to `0` (image can fully scroll off-screen)
- `constrainDuringPan` flips to `false` (no rubber-band during drag)
- `minZoomImageRatio` lowers to `0.05` so the image can shrink to a thumbnail
- The default `.fresco-viewer` dot-grid background that's present on every viewer becomes visible in the void around the image (in default clamped mode it's covered by OSD's canvas). The host div also picks up a `.fresco-viewer--infinite` modifier class so you can target infinite-mode-only styling.

The home button (`reset zoom`) still returns to "image fits viewport" — the image stays the anchor point, just no longer the cage. Default is `infinite_canvas={false}`, so every existing viewer keeps the stock clamped behavior with no template changes required.

---

## Multiple images on one canvas

Pass `:sources` (a list of maps) instead of `:src` to lay multiple images out on the same viewer. Each entry has `src` plus optional `x`, `y`, `width` in viewport units. The first image conventionally anchors the layout at `x: 0, y: 0, width: 1`, so `x: 1.1` means "just to the right with a 10% gap."

```heex
<Fresco.viewer
  id="gallery"
  sources={[
    %{src: "/uploads/a.jpg"},
    %{src: "/uploads/b.jpg", x: 1.1},
    %{src: "/uploads/c.jpg", x: 0, y: 1.1, width: 0.8}
  ]}
  class="w-full h-[80vh] rounded"
  infinite_canvas
/>
```

- Height is derived from each image's natural aspect ratio — don't specify it.
- Each entry's `src` runs through the same source-provider chain as the single-image `:src`, so you can mix plain images with DZI tile pyramids handled by Tessera.
- `:src` and `:sources` are mutually exclusive in practice — pass one. Both given, `:sources` wins.
- Typically paired with `:infinite_canvas` so the user can pan freely across the layout. Without it, "Reset view" fits all sources into the viewport at mount.
- Live re-renders that change the `:sources` list re-open the viewer while preserving the current zoom/pan — same trick as `swapSourcePreservingBounds`.

> ⚠️ **Caveat:** `handle.imageToScreen` / `screenToImage` currently operate on the **first source only**. If you're building an extension that needs to address pixels in source #2+ (e.g. annotations on a second image in the layout), you'll need to apply the offset yourself for now. Multi-image coordinate disambiguation is planned but not yet implemented.

---

## Optimized pan for long-scroll content

Opt-in mode tuned for the long-scroll reading use case (manhwa, manga, comics, document viewers) where the user is panning continuously, not zooming. By default, OpenSeadragon repaints the canvas via `ctx.drawImage(tile)` every pan frame — fine for desktop, painfully slow on iOS Safari even on recent hardware. `pan_optimized` swaps the per-frame redraw for a GPU-composited `transform: translate3d` glide while pan is in flight, dropping per-frame cost from ~10–20ms to <1ms.

```heex
<Fresco.viewer
  id="reader"
  src={~p"/uploads/chapter.jpg"}
  class="w-full h-screen"
  pan_optimized
/>
```

What changes when `pan_optimized` is on:

- On pan-start, OSD's drawer is temporarily swapped for a no-op; the canvas stops repainting per frame.
- Each pan tick applies `transform: translate3d(dx, dy, 0)` to the canvas element so the existing pixels visually glide with the user's gesture.
- On pan-end (or zoom-change / overscan bail), the transform is cleared, OSD's drawer is restored, and the canvas repaints once at the committed position.
- The fast path bails immediately if the user starts zooming, if rotation is active (`:rotate` invalidates the simple translate math), or if cumulative delta crosses ~50% of viewport height (overscan).

### Coordinating overlays — the `fast-pan` event

The fast path emits a synthetic `fast-pan` event on the handle so overlay extensions (annotations, ML highlights, custom HUDs) can transform in lockstep with the canvas. Three phases via `e.phase`:

```js
window.Fresco.onViewerReady("reader", function (handle) {
  var overlay = document.getElementById("my-overlay");
  handle.on("fast-pan", function (e) {
    if (e.phase === "start") {
      overlay.style.willChange = "transform";
    }
    if (e.phase === "start" || e.phase === "delta") {
      overlay.style.transform = "translate3d(" + e.x + "px, " + e.y + "px, 0)";
    }
    if (e.phase === "end") {
      overlay.style.transform = "";
      overlay.style.willChange = "";
      // OSD's viewport is now committed; your overlay can read fresh
      // coordinates from `handle.imageToScreen(...)` again.
    }
  });
});
```

[Etcher](https://hex.pm/packages/etcher) `>= 0.2.8` listens automatically — its SVG annotation layer transforms in lockstep with no consumer setup required. Older Etcher versions paired with Fresco `pan_optimized` will see annotations visibly drift during the pan window. Consumers without overlays can opt in unconditionally.

> **Default is off.** Existing viewers see no behavior change unless they explicitly pass `pan_optimized`.

---

## Strip mode for long-scroll content

When the user is **reading by scrolling** through a stack of full-width images — manhwa / manga, long-form comics, IG-style feeds, documentation snapshots — the OpenSeadragon-backed `<Fresco.viewer>` is the wrong architecture. OSD redraws its `<canvas>` on every pan frame; on iOS Safari that burns most of the 16ms 60fps budget for content that doesn't need zoom. The `pan_optimized` fast-path partially helps but breaks down on large snaps that move past the painted viewport area.

`<Fresco.scroll_strip>` is a sibling component for this exact case. Native browser scroll on DOM `<img>` elements. No canvas. No spring math. No per-frame JS. Memory windowing evicts off-screen image `src` attributes so a 50-image chapter doesn't pin hundreds of MB of decoded pixels.

```heex
<Fresco.scroll_strip
  id="reader"
  sources={[
    %{url: "/img/page-01.jpg", width: 720, height: 9200},
    %{url: "/img/page-02.jpg", width: 720, height: 8800},
    %{url: "/img/page-03.jpg", width: 720, height: 9100}
  ]}
  class="w-full h-lvh"
/>
```

### When to use which

| | `<Fresco.viewer>` | `<Fresco.scroll_strip>` |
|---|---|---|
| **Use case** | Deep-zoom imagery; single mega-image you pan/zoom around | Long-scroll reading; stack of full-width images |
| **Rendering** | OpenSeadragon canvas | DOM `<img>` + native scroll |
| **Zoom** | Yes (wheel, pinch, buttons) | No (one zoom level — full width) |
| **Pan** | OSD viewport math + spring | Native browser scroll |
| **Mobile 60fps** | Tricky (canvas redraw); `pan_optimized` helps | Free — native scroll is GPU-composited |
| **Memory** | OSD's tile lifecycle | Manual `src` evict outside ±N window |
| **Etcher overlays** | Yes, via OSD coords | Yes (Etcher >= 0.3 required — uses per-image coords) |

### Source-map requirements

Each source must include `:url`, `:width`, and `:height` (in source pixels). Width and height drive the `aspect-ratio` CSS on each `<img>`, which is what makes memory windowing safe — removing `src` doesn't collapse the slot, so the scroll position never jumps. Omitting either dimension raises `ArgumentError` at render time.

### The handle contract

Look up the strip handle the same way as a viewer (or use the `onReady` alias):

```js
window.Fresco.onReady("reader", function (handle) {
  // Scroll commands — replace panTo / panBy
  handle.scrollTo({imageIdx: 3, y: 0, behavior: "smooth"});
  handle.scrollBy({dy: 500, behavior: "instant"});

  // State for progress UI / chapter resume
  handle.getScrollState();
  // → { scrollTop, scrollHeight, viewportH, currentImageIdx, fractionWithin }

  // Coordinate adapters (per-image)
  handle.imageToScreen({imageIdx: 0, x: 100, y: 200});
  handle.screenToImage({x: 400, y: 800});
  // → { imageIdx, x, y }

  // Events
  handle.on("scroll", function (e) { /* e.scrollTop, e.scrollHeight (rAF-throttled) */ });
  handle.on("viewport-change", function (e) { /* e.currentImageIdx, e.fractionWithin */ });
  handle.on("image-loaded", function (e) { /* e.imageIdx */ });
  handle.on("image-evicted", function (e) { /* e.imageIdx */ });
  handle.on("open", function (e) { /* e.sources — fires once on mount */ });

  // Nav extension (strip ships with no built-in nav by default)
  handle.appendNavButton(svgString, "My button", function () { /* … */ });
});
```

### Server-pushed scrolling

For chapter-resume / programmatic snapping:

```elixir
push_event(socket, "phx:scroll-to", %{imageIdx: 5, y: 0, behavior: "smooth"})
```

The hook forwards the payload straight to `handle.scrollTo/1`.

### Memory windowing

Default keeps `±1 / ±3` images loaded around the dominant visible image. Configure with `:window_before` and `:window_after`:

```heex
<Fresco.scroll_strip
  id="reader"
  sources={@sources}
  window_before={2}
  window_after={5}
/>
```

Images outside the window get `src` evicted; on re-entry, `src` is restored and `image-loaded` fires. The `aspect-ratio` style on every `<img>` (computed from your source's width/height) keeps the layout perfectly stable through evict/restore cycles — no scroll jumps.

### Optional CSS scroll-snap

For IG-feed-style content (one image per screen):

```heex
<Fresco.scroll_strip id="feed" sources={@sources} snap_to_image={:mandatory} />
```

Accepts `:off` (default), `:mandatory`, `:proximity`. For tall continuous content (manhwa pages), keep at `:off` — snap would either lock you to image tops or yank mid-read.

### Etcher annotations

Etcher `>= 0.3` is required to render annotations on strip mode. Etcher's renderer adapter feature-detects via `"scrollTo" in handle` and dispatches to a strip-positioning module that inserts overlay nodes as siblings of the `<img>` elements — they scroll with the content natively, no per-frame positioning needed. Annotation payloads gain an `imageIdx` field (defaults to `0` for back-compat with viewer annotations).

`handle.openSeadragon` is intentionally a **throwing getter** on the strip handle — accessing it usually means an overlay was written for the viewer host without a renderer adapter, and the thrown message points at the fix. Etcher 0.2 paired with a strip handle will see the error and fail loudly; that's by design.

> ⚠️ **No zoom in strip mode.** If your reader needs occasional zoom (pinch / double-tap), use `<Fresco.viewer>` instead — strip mode is one zoom level by design.

---

## Rotation

Opt-in 90° rotation button. Adds a fifth button to the nav column that rotates the image 90° clockwise each click. Rotation is tracked independently of zoom/pan, so "Reset view" recenters without un-rotating.

```heex
<Fresco.viewer
  id="photo"
  src={~p"/uploads/photo.jpg"}
  class="w-full h-[80vh] rounded"
  rotate
/>
```

Default is `rotate={false}` — every existing viewer keeps the stock four-button layout.

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

Fresco publishes each live viewer to `window.Fresco.viewerFor(domId)`. Peer libraries (Tessera for deep zoom, future Etcher for annotations, etc.) look up the handle and attach without forking the viewer.

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

### Advanced: OSD escape hatch

Fresco's handle exposes the underlying OpenSeadragon Viewer instance at `handle.openSeadragon`. Use this when you need an OSD API that Fresco doesn't surface first-class — pan/zoom constraints, raw event handlers (`canvas-double-click`, `canvas-key`, …), OSD plugin registration, gesture rebinding, etc.

```js
window.Fresco.onViewerReady("photo", function(handle) {
  // Disable panning entirely (e.g., for a reader pinned at fit-zoom):
  handle.openSeadragon.panHorizontal = false;
  handle.openSeadragon.panVertical = false;

  // Listen to OSD events Fresco doesn't bridge:
  handle.openSeadragon.addHandler("canvas-double-click", function(e) {
    // your custom double-click behavior
  });

  // Override OSD constraints after mount:
  handle.openSeadragon.viewport.minZoomImageRatio = 1.0;
});
```

#### The contract

- `handle.openSeadragon` is a real, current OpenSeadragon Viewer — anything in the [OSD API docs](https://openseadragon.github.io/docs/) works.
- Reaching for the escape hatch couples your code to **OSD's API and version**, not just Fresco's. If we ever swap the underlying engine, escape-hatch consumers will need to migrate.
- Fresco pins the OSD CDN version — see `OSD_VERSION` in `priv/static/fresco.js`. The CHANGELOG flags any OSD version bump.
- **If you find yourself reaching for the escape hatch routinely, file an issue.** Common patterns should become first-class Fresco APIs.

#### `handle.viewer` (back-compat alias)

`handle.viewer` is the original name for this field — it has existed (undocumented) since Fresco's first release, and [Etcher](https://hex.pm/packages/etcher) already depends on it in production. It's retained indefinitely as a back-compat alias for `handle.openSeadragon`. New code should prefer `openSeadragon` — it disambiguates from "the Fresco viewer" (the component / handle itself, the colloquial referent in Fresco's own docs) and signals that you're crossing into OSD territory.

---

### Source providers

Override Fresco's default "treat the URL as a plain image" behavior for specific URL patterns:

```js
window.Fresco.registerSourceProvider(
  function(url) { return url.toLowerCase().endsWith(".dzi"); },
  function(url) { return url; }    // OSD takes a DZI URL directly
);
```

This is how Tessera (the deep-zoom layer that builds on Fresco) attaches: it registers a `.dzi` source provider so DZI manifests automatically trigger tile loading.

---

## Family of packages

Fresco is the foundation. Related published packages:

- **[`tessera`](https://hex.pm/packages/tessera)** — deep zoom for very high-resolution images via DZI tile pyramids. Built on Fresco.
- **Etcher** *(planned)* — annotation + markup tools (drawing, arrows, text, comment threads on regions of an image). Will build on Fresco.

You can use Fresco entirely on its own; you don't need any of the related packages.

---

## License

MIT — see [LICENSE](./LICENSE).
