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
