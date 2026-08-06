# open_fresco — design & task doc

**Status:** All phases done — `open_fresco` v0.5 (scene model, SVG generator,
og feature parity, PNG rasterizer, measurement-accurate layout + anchoring,
editor stage, og import). 87 tests. PNG output verified end-to-end against
the resvg NIF; measured wrap + anchor reflow confirmed visually. **Remaining
before an og cutover:** browser-verify the editor LiveComponent + JS hook
(the mutation core is unit-tested but the interactive layer isn't), and run
the actual og-side migration (import stored canvases, swap the render call,
delete og's SVG/rasterizer code). Reality-checked against shipping
`phoenix_kit_og` 0.2.1.
**Author:** Claude (with Alexander Don)
**Date:** 2026-07-22
**Consumer driving it:** `phoenix_kit_og` (OG-image module) — see its
"Fresco editor + renderer" feature checklist, and the reality-check
section below (read against the actual 0.2.1 source).

---

## 0. TL;DR / verdict

**Doable, and it can be built without breaking any existing fresco
integration (etcher, tessera).** But it is a **substantial new package**,
not a thin fresco wrapper. Fresco contributes ~20% (the artboard shell,
the serialization + `extensions` convention, the pan/zoom engine). The
other ~80% is net-new, and it's dominated by one thing fresco has nothing
to do with today: **a deterministic, browser-free server renderer that
produces PNGs.**

Three load-bearing decisions make the hard gates tractable:

1. **The scene lives in a fresco `extensions["open_fresco"]` blob** (same
   pattern etcher uses for `extensions["etcher"]`). Fresco never inspects
   it → etcher and tessera cannot regress. Storing the scene needs **zero
   fresco changes**.
2. **SVG is the single intermediate representation.** Scene → SVG → raster.
   SVG natively covers gradients (per-stop alpha), image fills
   (cover/contain/stretch), gradient overlays/masks, rounded-rect buttons,
   and z-order — so most of §1's fill/shape gates become "emit the right
   SVG," not "invent a drawing model."
3. **The server is the SOLE text-layout authority; the editor displays
   server-rendered SVG.** This is the move that kills the scariest gate
   (§2 "editor text layout matches the server render"). With one layout
   engine there is nothing to keep in sync — parity is automatic, and so
   is determinism.

The two biggest lifts *looked* like the **rasterizer** (resvg / tiny-skia
class) and **server-side text measurement** feeding wrap/auto-width/anchors.

**Recommendation (revised — see §0.5 and §8):** the reality check against
shipping `phoenix_kit_og` 0.2.1 removed the rasterizer as an unknown — og
already ships a working resvg-based one we can adopt as an optional dep — so
**no Phase-0 spike is needed.** The scope is unchanged, though: **every
checklist gate is required before og can switch** (see §8's revised,
dependency-ordered plan). This first framing is kept for history; §0.5
onward is current.

---

## 0.5. Reality check — vs shipping `phoenix_kit_og` 0.2.1 (added 2026-07-22)

Read against the **actual 0.2.1 source** (fetched from Hex), not just the
checklist. Two headline takeaways change the plan below: **og's SVG core
and open_fresco's are the same design** (so migration is realistic), and
**og already ships the rasterizer we thought we'd have to invent** (so the
"hardest gate" is de-risked). The doc's original framing over-weighted the
rasterizer as an unknown; it's a known quantity.

### Architecture: near-identical

og's `Render.Svg` and `open_fresco`'s `OpenFresco.Svg` independently landed
on the same design — canvas JSON (1200×630, `background: {type, value}` +
z-ordered `elements`), fresh native `<text>`/`<tspan>` generation
(both explicitly reject reusing editor HTML / `<foreignObject>`),
**deterministic output for cache-key hashing** (both say so by name), and
the same hardening: clamp dims (OOM guard), escape strings (injection),
unresolved-placeholder → safe fallback (no broken-image / black-square).
Same `fit → preserveAspectRatio` map. open_fresco reads like a clean-room
reimplementation of og's `render/svg.ex` core — which is exactly what makes
a swap plausible.

### Feature comparison

| Capability | og 0.2.1 | open_fresco 0.1 | Note |
|---|---|---|---|
| text / image / rect(=shape) elements | ✅ | ✅ | parity |
| background color / image, image `fit` | ✅ | ✅ | parity |
| **gradient fills** (angle, multi-stop, per-stop alpha) | ❌ | ✅ | open_fresco **adds** (a checklist gate og lacks) |
| **button / CTA composite** (solid/outline/soft) | ❌ (og "buttons" are editor UI) | ✅ | open_fresco **adds** (gate) |
| **text word-wrap** | ✅ (manual, ~0.55em estimate) | ❌ | **real gap** |
| **valign** (top/middle/bottom) | ✅ | ❌ | **real gap** |
| **per-element underlay / bg overlay tint** | ✅ | ❌ (gradient scrims instead) | **real gap** (og relies on it for legibility) |
| **`{{slot}}` + `[[global]]` inline substitution** | ✅ (mustache-style, slot-type inference, auto-globals) | ❌ (whole-value `{:placeholder}`) | **real gap — semantic divergence** |
| `stamp` element (preset text) | ✅ | ❌ | minor |
| locale as render input | ✅ (`[[page_locale]]`, `context.language`) | ➖ (caller passes resolved values) | both handle it, differently |
| element-to-element **anchoring** | ❌ (only SVG `text-anchor`) | ❌ (field reserved, no reflow) | **required checklist gate** neither ships yet — open_fresco must add it (Phase 4) |
| **PNG rasterizer** | ✅ `:resvg_nif → :resvg_cli → rsvg-convert → magick` + caching | ❌ SVG-only | **biggest gap** — og's whole point |
| domain layer (hierarchical assignments, admin editor, caching, discovery) | ✅ | — | og **keeps** these (checklist §4); not open_fresco's job |

### Two decisions this surfaces

**A. The rasterizer is already solved — adopt og's approach, don't invent.**
og uses the **`:resvg` Hex package** (mrdotb/resvg_nif — a precompiled NIF
via `rustler_precompiled`) with a graceful fallback chain to the `resvg`
CLI, `rsvg-convert`, then ImageMagick, selected at runtime by
`which_backend/0`. It's an **optional** dep (a hard `rustler_precompiled`
pin in resvg 0.5.0 means hosts opt in). This removes the original plan's
Phase-0 rasterizer unknown: we do **not** hand-roll a Rustler NIF — we depend
on `:resvg` optionally and copy og's backend-detection + fallback shape. The
design doc's "high-risk
NIF" reduces to "wire an existing package + fallbacks."

**B. The substitution model diverges, and og's is richer.** og substitutes
named tokens *inside* strings — `{{slot}}` (template-local, wired to module
variables at assignment time, **type-inferred** from where they appear) and
`[[global]]` (auto-resolved from settings/context: site host, page URL,
locale). open_fresco's `{:placeholder, key}` replaces a *whole value*, has
no inline interpolation, no globals, no type inference. og's entire domain
layer (`Slots`, `Assignments`, the wiring UI) is built on the token model.
**To replace og, open_fresco must adopt an inline-token substitution model
compatible with `{{…}}` / `[[…]]`** (or og adapts its domain layer to ours —
less likely, since the checklist says og keeps its domain layer). Decision
needed early; it shapes the `values` API. See §10.

### What "matching og" actually requires

open_fresco already matches og's *architecture* and core element model, and
**exceeds** it on gradients + buttons (the gates og itself doesn't have).
The gap to a real drop-in is a specific, bounded list: **text wrap, valign,
underlay, the `{{slot}}`/`[[global]]` substitution model, and the PNG
rasterizer.** The roadmap below is reordered to close *those* first.

---

## 1. What fresco is today (and why it's a good base but not the engine)

`Fresco.Canvas` (`lib/fresco/canvas.ex`) is:

```
%Fresco.Canvas{
  version: "1",
  canvas: %{width, height, background, __extra__},
  images: [ %{id, src, x, y, width, z_index, natural_*, __extra__} ],
  extensions: %{ "name" => any },   # opaque per-package blobs
  __extra__: %{}
}
```

- It knows about **positioned images only**. No text, shapes, fills,
  gradients, or anchoring.
- The viewer (`lib/fresco/viewer.ex` + `priv/static/fresco.js`, ~2.8k LOC)
  is a **pure browser CSS-transform engine** — pan/zoom/fit, a handle API
  (`screenToImage`/`imageToScreen`/`getCanvasSize`), nav buttons. It emits
  no SVG and does no measurement.
- **There is zero server-side rendering anywhere in fresco.** No native
  deps (`jason`, `phoenix_live_view`, `phoenix_html` only). No PNG, no SVG,
  no raster.

So fresco is a *skeleton*: a coordinate space + a browser viewer + a
serialization contract that peer packages (etcher, tessera) extend via the
`extensions` map. That is precisely the seam open_fresco should use.

**What open_fresco reuses from fresco:**

- `<Fresco.canvas>` as the **editor artboard** — pan/zoom/fit around a
  fixed 1200×630 board (the `infinite_canvas` mode already gives free
  panning; see §5 for the one possible additive tweak).
- The handle API (`screenToImage` etc.) for drag/resize hit-testing —
  same integration etcher already relies on.
- `Canvas.to_json!/from_json!/write!/read!` + `put_extension/3` +
  `extensions` for **serialization and storage**.

**What open_fresco does NOT get from fresco:** the entire renderer, the
scene/element model, text layout, fills, anchors, locale resolution.

---

## 2. Architecture

### 2.1 Data flow

```
                      ┌─────────────────────────── EDITOR (browser) ──────────────┐
  scene (struct) ──►  │  host LiveView owns the properties panel                   │
        ▲             │  open_fresco editor stage embeds in <Fresco.canvas>        │
        │             │  drag/resize/select/nudge → scene edits → server           │
        │             │  server returns SVG preview → stage displays it            │
        │             └────────────────────────────────────────────────────────────┘
        │
        │  render(scene, values, opts)      ┌──────────── RENDERER (server) ────────┐
        └───────────────────────────────►   │ resolve placeholders + locale         │
                                             │ measure text (shared font stack)      │
                                             │ solve anchors → reflow                │
                                             │ emit SVG (fills, gradients, images)   │
                                             │ resvg/tiny-skia rasterize → PNG       │
                                             └───────────────────────────────────────┘
                                                       │
                                                       ▼
                                             {:ok, png_binary, %{width, height}}
```

### 2.2 The three decisions, expanded

**D1 — Scene as a fresco extension blob.** The scene serializes into
`extensions["open_fresco"]` on a `Fresco.Canvas`. The `images` array can
stay empty (or be ignored); open_fresco's own element list lives in the
extension. This is *non-breaking by construction*: fresco treats the blob
as opaque, exactly like `extensions["etcher"]`.
*Open question (D1a):* does the **renderer** need a `Fresco.Canvas` at all?
It does not — it only needs the scene. So `OpenFresco.Scene` should be a
standalone struct that can be *carried inside* a fresco extension for
editing/storage but rendered with no fresco dependency. This keeps the
renderer (and its native dep) usable headlessly and keeps fresco out of
the render hot path.

**D2 — SVG as the single IR.** Both the editor preview and the final PNG
come from the *same* SVG generator (`OpenFresco.Svg.render(scene, values)
:: iodata`). Rasterization is the only step that differs (browser displays
the SVG; server rasterizes it). One generator → editor and print are the
same by definition.

**D3 — Server is the sole layout authority.** SVG `<text>` does not
auto-wrap, so *someone* must measure + wrap. We do it **once, on the
server**, and the browser never runs its own text engine — it just renders
the SVG the server produced. Consequences:

- §2 gate "editor text layout matches server render" → **free.**
- §3 gate "deterministic" → **free** (no browser variance).
- Cost: each edit round-trips to the server for a fresh SVG preview. For an
  OG editor (deliberate, low-frequency edits — not 60fps dragging) this is
  fine. Drag *feedback* can be a cheap client-side transform of the
  existing SVG (move the selected group), with an authoritative re-render
  on drop.

### 2.3 Text-measurement parity (the crux of the renderer)

Wrapping requires measuring; the raster must render exactly what we
measured. The rule: **measurement source == render font source.**

Two implementation options — recommend **Option A**:

- **Option A (Elixir layout, Rust measure+raster).** A single native
  module owns a font database and exposes:
  - `measure(font_key, size_px, weight, text) -> {width, ascent, descent}`
  - `render_svg(svg_iodata, opts) -> png_binary`
  Elixir does wrap/auto-width/anchor math using `measure/…`, emits final
  SVG with explicit x/y and either `<text>` (rendered by resvg's font
  engine — same fontdb) or pre-converted text paths. Layout logic stays in
  Elixir (easy to unit-test with golden numbers). **Parity holds because
  both `measure` and `render_svg` use the same bundled fontdb.**
- **Option B (all in Rust).** NIF takes the scene/layout-spec, does
  measure+wrap+layout+rasterize in Rust (usvg/rustybuzz/resvg). Less
  Elixir logic, but layout becomes hard to test/iterate and every layout
  tweak is a recompile. Rejected unless Option A hits a measurement wall.

**Verify before building:** whether a maintained Elixir/Hex wrapper for
resvg/tiny-skia exists (e.g. a rustler NIF package) or whether we hand-roll
a NIF around the `resvg` Rust crate. Do not assume one exists — the spike
settles this. `librsvg`/`vix` is a fallback rasterizer but is *rejected for
the gate* (font handling + determinism are worse than resvg; the checklist
explicitly names resvg/tiny-skia class).

---

## 3. Scene model (`OpenFresco.Scene`)

Versioned Elixir structs. Sketch (names to firm up in Phase 1):

```
Scene    = %{ version, canvas: Canvas, elements: [Element], fonts: [FontSpec] }
Canvas   = %{ width, height, background: Fill }
Element  = Text | Image | Shape | Button        # tagged, has: id, z_index, box, anchor?
Fill     = {:solid, color}
         | {:gradient, %{angle, stops: [%{offset, color, alpha}]}}
         | {:image, %{value, fit: :cover|:contain|:stretch}}
Anchor   = %{to: element_id, edge: :top|:bottom|:left|:right, gap, align}
Value    = literal | {:placeholder, key}        # resolved by render(scene, values)
```

Gate-by-gate coverage of §1:

| §1 gate | Where it lives | Notes |
|---|---|---|
| Element types text/image/shape/**button composite** | `Element` variants | Button = shape + label + padding + preset(solid/outline/soft) + radius; auto-width from measured label |
| Template values (placeholders) | `Value = {:placeholder, key}` | Resolved in `render(scene, values)`, never baked |
| Fill types (solid/gradient/image w/ fit) | `Fill` union | Direct SVG: `<linearGradient>`, `<image preserveAspectRatio>` |
| Gradient overlay/mask on image | element stacking + `<linearGradient>` with alpha, or SVG `mask` | The "photo fading into a dark field" case |
| Anchored elements + reflow + cycle rejection | `Anchor` + a topo-sort solver | Solver runs after text measurement (heights known); reject cycles with `{:error, {:anchor_cycle, ids}}` |
| **Unresolved-image placeholder** (first-class) | `Image` with unresolved `Value` → neutral stand-in draw path | **Never** a nested `data:image/svg+xml` (og's black-square/lost-caption trap) — draw a plain rect + centered label in SVG primitives |
| Locale as render input | `values` carry the resolved locale; translatable `Value`s resolve per-language | Two locales = two `render/3` calls = two PNGs |
| Z-order; fixed dims | `z_index`; `Canvas.width/height` | Stable sort before SVG emit |
| Fill-type switch preserves other tabs' values | store all three fill variants' last values in the element, `Fill` selects active | Editor concern; scene keeps the inactive values in `__extra__`-style slots |
| Versioned + migratable format | `version` + `OpenFresco.Scene.migrate/1` | Mirror fresco's `version` discipline |

---

## 4. Renderer (`OpenFresco.Renderer`)

**Contract (gate):**

```elixir
@spec render(Scene.t(), values :: map(), opts :: keyword()) ::
        {:ok, binary(), %{width: pos_integer(), height: pos_integer()}}
        | {:error, term()}
```

- **Never raises** — all failures are `{:error, term}`.
- **No browser, no network at render time.** Image inputs arrive as
  **bytes or paths** in `values`; the renderer never fetches.
- **Deterministic:** same `(scene, values)` → byte-stable PNG.
- **`OpenFresco.Renderer.version/0`** — a string the caller folds into
  cache keys so cached PNGs invalidate on a renderer upgrade.
- **Hardened for user-authored scenes (gate):** clamp `width`/`height` to a
  sane max (no OOM from a crafted 1e9×1e9 canvas); treat **all strings as
  untrusted** (escape before they enter SVG — no markup/attribute
  injection); tolerate unknown fields (forward-compat with newer editors).
- **Text (gate):** multi-line word wrap, font weights, per-element fonts,
  and a fallback chain that works on a bare Linux host — **DejaVu Sans /
  Liberation Sans**, with "Arial" as a *name only* (libre metrics substitute
  when Arial is absent). Text measurement drives auto-width buttons and
  anchor reflow.
- **Embedded rasterizer (gate):** resvg/tiny-skia class NIF. A headless
  browser does **not** qualify.
- **Output declares pixel width/height** (for `og:image:width/height`).
- **Target ~50 ms** at 1200×630 on typical hardware (crawler request path;
  caller caches — og already owns PNG caching + serving).
- **Optional-dependency pattern:** the native rasterizer is an optional
  dep so hosts that only use the **editor** don't pay for the renderer
  (compile-time gate + a clear `{:error, :renderer_unavailable}` if called
  without it). Mirrors how the checklist's §3 last bullet asks for it.

**Pipeline:** resolve placeholders/locale → measure text → solve
anchors/reflow → generate SVG (`OpenFresco.Svg`) → rasterize (NIF) →
`{:ok, png, dims}`.

---

## 5. Changes to fresco / etcher (all additive, all optional)

The user has approved touching fresco/etcher if needed. Current read: the
**mandatory** set is empty — the extension seam already suffices. The
following are *nice-to-haves* for the editor UX, each additive and covered
by the owning package's own suite:

**Fresco (optional):**
- **Bounded "artboard" fit mode.** `infinite_canvas` already pans over
  empty space; the editor wants "fit a fixed W×H board, don't let it get
  lost." May be expressible with existing attrs — **verify first**; only
  add a `:fit => :artboard`-style option if the current viewer can't frame
  a fixed board cleanly. Additive attr → no impact on etcher/tessera.
- Nothing else. Background stays a simple CSS color (gradient/image
  backgrounds are an open_fresco *scene* concern rendered in SVG, not a
  fresco responsibility).

**Etcher (decision, not a requirement):** the editor stage needs
drag/resize/select/nudge/delete — which etcher already implements well
(handles, hit-test, move/resize, the `layerFor` API, coordinate helpers we
just added for the image tool). **But etcher's model is
annotation-shaped** (per-kind shapes with stroke/fill), while open_fresco
needs a richer scene (text-with-fills, buttons, gradients, anchors). Two
paths:
  - **(Recommended) open_fresco ships its own editor overlay**, reusing
    etcher's *proven patterns* (SVG overlay on a fresco handle, corner
    handles, the `screenToImage` round-trip) but with its own scene-shaped
    element model. Keeps etcher unbent and focused.
  - (Alt) Generalize etcher's shape system to carry open_fresco's elements.
    Risky — coupling two products' models; only if code duplication proves
    painful.
  Either way, **no breaking etcher change** is implied.

---

## 6. Editor (`OpenFresco.Editor`, browser stage)

Gate mapping for §2:

| §2 gate | Approach |
|---|---|
| Drag/resize/select, keyboard nudge, delete; pan/zoom/fit | Overlay on `<Fresco.canvas>`; reuse etcher-style handles + fresco pan/zoom |
| Embeddable; host owns properties panel; host gets selection/change events; can update scene programmatically | LiveView hook emits `open_fresco:selection` / `open_fresco:scene-changed`; host pushes scene updates back (same shape as etcher's `annotations-changed` round-trip) |
| **Editor text layout matches server render** | **D3** — stage displays server-rendered SVG; no browser text engine |
| Anchor authoring (pick target/edge/gap) | Host UI drives it via events; stage can show anchor affordances |
| JS ships as a bundle on the LiveSocket (no inline `<script>`; survives LV nav) | Same delivery as `window.FrescoHooks`/`EtcherHooks` |
| Instance-scoped DOM ids | Derive from the layer/fresco id, like etcher's `etcher-layer-<id>` |

---

## 7. Non-breaking guarantees (why etcher/tessera are safe)

1. **Namespaced extension.** Scene stored under `extensions["open_fresco"]`;
   fresco never inspects it. Etcher stays in `extensions["etcher"]`. No key
   overlap, no shared code path.
2. **Renderer has no fresco dependency** (D1a) — it can't affect the viewer.
3. **Fresco/etcher changes, if any, are additive** (new attrs / new API),
   defaulted off, and gated by each package's existing test suite
   (`test/etcher_test.exs` component asserts, fresco's viewer tests).
4. **Native rasterizer is an optional dep** — editor-only and
   renderer-absent hosts compile and run without it.

---

## 8. Phased plan (revised 2026-07-22 after the og 0.2.1 reality check)

The original plan led with a "high-risk rasterizer NIF" spike. The reality
check moved that risk down (og ships a working resvg-based rasterizer we can
adopt), but the **scope is unchanged: the full checklist is the target, and
every gate must land before cutover.** Two kinds of remaining work: (1)
**og-parity** the shipping 0.2.1 already has — wrap, valign, underlay, the
`{{slot}}` model — closable in pure Elixir; and (2) **checklist gates that go
beyond og's current features** — measurement-accurate layout, anchoring +
reflow, button auto-width, gradient masks — which are equally required. The
plan is reordered so the risky-looking native piece is de-risked early and
the required gates are sequenced by dependency, not dropped.

Key correction the source review surfaced: **og's *current* text wrap is a
character-count estimate (`width / (size·0.55)`), not font measurement.** So
Phase 2 can reach behavioral parity with og's wrap in pure Elixir with no
font engine — but that's only a *stepping stone*. The checklist's §2 gate
("same wrap points, same measured sizes") requires **measurement-accurate**
wrap, which lands in Phase 4 on the rasterizer's font stack and is required
for cutover.

**Phase 1 — Scene + SVG generator. ✅ DONE (v0.1, committed).**
`OpenFresco.Scene` (versioned structs, JSON serialization, `migrate/1`);
`render_svg/3` for text/image/shape with solid + **gradient** fills, image
fit, multi-line text (explicit `\n`), **button composite** (presets),
z-order; hardening (clamp, escape, `version/0`); neutral unresolved-image
stand-in; 26 tests. Plus `open_fresco_test` (Phoenix host) for live preview.

**Phase 2 — og feature parity (NEXT, still pure Elixir).** Close the gaps
the reality check found, so a scene can express everything an og template
does today:
- **Text word-wrap** — port og's char-estimate wrap (`~0.55em`) for
  behavioral parity now; leave a seam for measurement-accurate wrap later.
- **`valign`** (top/middle/bottom) on text blocks.
- **Per-element underlay** + background image **overlay tint** (og's
  legibility mechanism), alongside the gradient scrim we already have.
- **`{{slot}}` / `[[global]]` inline substitution** — adopt og's token model
  (see Decision B / §10): substitute named tokens *inside* text and image
  `src` strings, with slot-type inference; `[[global]]` resolves from a
  caller-supplied globals map. This supersedes the whole-value
  `{:placeholder}` (keep it working as a degenerate case). **Load-bearing
  for reusing og's Slots/Assignments domain.**
- `stamp` (preset text) element; locale threaded as a render input.
- Golden-SVG tests mirroring og templates.

**Phase 3 — PNG rasterizer. ✅ DONE (v0.3).** `OpenFresco.render/3 → {:ok,
png, %{width, height}} | {:error, term}` (never raises, no network,
deterministic) backed by `OpenFresco.Rasterizer` — the **`:resvg` Hex
package** as an **optional** dep, with og's runtime backend-detection +
fallback chain (`:resvg_nif → :resvg_cli → rsvg-convert → magick → :none`)
ported. `Renderer.version/0` folds generator + rasterizer revisions for
cache keys. Verified end-to-end against the resvg NIF (a real 1200×630 RGBA
PNG, wrapped title). `open_fresco_test` gained a `GET /card.png` endpoint —
the crawler-facing path. No hand-rolled NIF.

**Phase 4 — Measurement-accurate layout + anchoring (REQUIRED — checklist
gates).** Not optional polish: the checklist gates every item here, and og
will not switch without them. Sequenced here because they build on the font
stack the Phase-3 rasterizer lands, and refine (not replace) Phase 2's
char-estimate wrap:
- **Measurement-accurate text layout** — real glyph advances from the
  rasterizer's font database, replacing Phase 2's char-estimate. This is the
  §2 gate *"editor text layout matches the server render — same wrap points,
  same measured sizes,"* which the checklist calls **"the main reason to
  adopt a shared engine."** It drives the next two items.
- **Element-to-element anchoring + reflow** — the §1 gate: element B
  anchored to A (edge + gap + alignment) moves when A's *measured* height
  changes (title wraps to two lines → subtitle + CTA shift down); chains
  (C→B→A) resolve, cycles are rejected. **Neither og nor open_fresco ships
  this today — open_fresco must add it.** A topological solver over measured
  boxes.
- **Button auto-width** — width from the measured label (the §1 button gate).
- **Gradient mask on images** — the §1 gate (a photo fading into a solid
  field via an alpha mask, beyond the scrim rect we already emit).

**Phase 5 — Editor stage.** Embed in `<Fresco.canvas>`; drag/resize/select/
nudge/delete; server-authoritative SVG preview (D3); host eventing
(selection/scene-changed); **anchor authoring** (pick target/edge/gap);
bundle on LiveSocket; instance-scoped ids. (The phase that finally exercises
fresco and may surface the one optional fresco change in §5.)

**Phase 6 — og validation & cutover** (og-side, unblocks their delete; must
come last — depends on every gate above). Validate against a text-heavy real
template (measured wrap + valign + underlay + anchor reflow + slot + gradient
+ locale); migrate stored canvases to the scene format; swap og's editor
stage + render call; delete og's SVG/rasterizer/placeholder code. og keeps
its domain layer (assignments, caching, admin). Until this phase og runs
unchanged — nothing here blocks either schedule.

---

## 9. Risks & effort

| Item | Risk / effort | Mitigation |
|---|---|---|
| PNG rasterizer | ~~High~~ → **Med** (downgraded) | **Adopt og's `:resvg` optional dep + `which_backend/0` fallback chain** — no hand-rolled NIF. Proven in og 0.2.1. |
| `{{slot}}`/`[[global]]` substitution model | **Med** (new, semantic) | Port og's `Slots` regex + type-inference; keep whole-value `{:placeholder}` as a degenerate case |
| Text wrap — char-estimate (Phase 2, og parity) | **Low** | og's own wrap is a char-estimate, not measurement — copy it; pure Elixir |
| Measurement-accurate wrap (Phase 4, **required gate**) | Med | Rides in with the rasterizer's font stack; refines the estimate to satisfy the §2 "same wrap points/sizes" gate |
| Element anchoring + reflow (Phase 4, **required gate**) | Med | Topo-sort over *measured* boxes + explicit cycle error. Neither og nor open_fresco ships it — open_fresco must add it |
| SVG generation breadth | Low–Med | SVG does the heavy lifting; open_fresco already covers fills/gradients/buttons |
| Scene schema + migration | Low | Done in v0.1; mirror fresco's `version` discipline |
| Editor stage | Med | Reuse etcher patterns; server-authoritative preview removes the parity trap |
| Font bundling/licensing | Low | DejaVu/Liberation are libre; "Arial" is a *name* only, never shipped |

**Overall (revised):** the reality check lowered the *risk*, not the scope.
The "hard unknown" (rasterizer) is a solved, adoptable dep, so no go/no-go
spike is needed. But the full checklist is still the target, and **every
gate must land before cutover** — the pure-Elixir parity work (Phase 2:
wrap-estimate/valign/underlay/slots), the rasterizer (Phase 3), the
measurement-driven gates (Phase 4: accurate wrap, anchoring + reflow,
button auto-width, gradient mask), and the editor (Phase 5). Nothing on the
checklist is optional; the sequencing just reflects dependencies. Every gate
maps to a known technique, most already demonstrated in og's source.

---

## 10. Open questions for the team

1. **Decision B — substitution model (highest-priority; blocks Phase 2).**
   Adopt og's inline-token model (`{{slot}}` with type inference +
   `[[global]]` auto-resolution) so open_fresco can reuse og's
   `Slots`/`Assignments` domain. Recommend **yes** — port og's `Slots` regex
   and semantics; keep the whole-value `{:placeholder}` as a degenerate case.
   Confirm the token *syntax* stays byte-compatible with og's (so stored
   templates migrate without rewriting bindings).
2. **Editor: own overlay vs generalize etcher.** Recommend own overlay
   (§5). Confirm before writing editor code (Phase 5).
3. **Editor preview latency budget** — is a server round-trip per drag-drop
   acceptable to og's admin UX, or do we need client-side drag feedback with
   authoritative re-render on drop? (Recommend the latter.)
4. **Font set to bundle** (DejaVu Sans + Liberation Sans confirmed; any
   others og needs — e.g. a display weight for titles?). Must match the font
   db the Phase-3 rasterizer uses, or measured wrap (Phase 4) won't match.

**Settled since the first draft:**
- **D1a — scene standalone vs fresco-bound** → **standalone.** v0.1 ships
  `OpenFresco.Scene` with no fresco dependency; it merely *embeds in* a
  fresco extension for editing/storage.
- **Rasterizer sourcing** → **adopt the `:resvg` Hex package** (optional dep)
  with og's `which_backend/0` fallback chain. No hand-rolled NIF; no Phase-0
  spike.
- **Package location** → new sibling repo `open_fresco` (created, v0.1
  committed), with `open_fresco_test` as the Phoenix host harness.

---

## Appendix — the og checklist, mapped

Every `(gate)` item from `phoenix_kit_og`'s checklist and where it's
satisfied:

- §1 element types / template values / fills / gradient overlay /
  unresolved-image / locale → **§3 scene model table** (done in v0.1 except
  underlay/overlay → Phase 2); **anchoring gate → Phase 4.**
- §2 editor drag-resize / embeddable / bundle / scoped ids → **§6 editor
  table** (Phase 5); **wrap-parity gate ("same wrap points/sizes") → Phase 4**
  (measurement-accurate), parity to editor via **D3**.
- §3 `render/3` no-raise-no-browser / text+fonts / deterministic+version /
  hardened / embedded rasterizer / declared dims / ~50 ms / optional dep →
  **§4 renderer contract, Phase 3** (adopt og's `:resvg` + fallbacks).
- §4 og cutover → **Phase 6** (last; depends on every gate above).
