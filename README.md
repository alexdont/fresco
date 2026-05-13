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

> **Future API:** A planned `:sources` attribute will accept a list of `[%{src: "...", offset: {x, y}}]` for placing multiple images on the same canvas. The current `:src` will continue to work as a single-image shortcut — no migration required.

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
