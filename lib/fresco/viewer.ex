defmodule Fresco.Viewer do
  @moduledoc """
  Phoenix LiveView function component that mounts a Fresco viewer.

  Renders a host `<div>` containing a stage `<div>` and an `<img>`. The
  companion JS hook (`FrescoViewer` in `priv/static/fresco.js`) attaches
  Pointer Events for unified mouse/touch/pen gestures, applies
  `transform: translate3d(tx, ty, 0) scale(s)` on the stage element, and
  publishes a handle to `window.Fresco.viewerFor(id)` so peer extensions
  (Tessera, future Etcher) can attach.

  The image is server-rendered inside the host so it appears immediately —
  the hook reads `naturalWidth/Height` on mount and fits the image into
  the viewport without any "blank box" flash.

  ## Usage

      <Fresco.viewer
        id="photo"
        src={~p"/uploads/photo.jpg"}
        class="w-full h-[80vh] rounded"
      />

  ## Interactions

  - **Pan**: click/touch drag, arrow keys (after focusing the viewer)
  - **Zoom**: mouse wheel (centered on cursor), pinch (two-finger on touch
    or trackpad), double-click (2× centered on cursor), `+`/`-` keys
  - **Reset**: nav button, `0` key — fits the image to the viewport
  - **Fullscreen**: nav button, `f` key — toggles native browser fullscreen

  ## Parent app setup

  Import the JS hook and spread `FrescoHooks` into your LiveSocket hooks:

      import "../../deps/fresco/priv/static/fresco.js"

      let liveSocket = new LiveSocket("/live", Socket, {
        hooks: { ...window.FrescoHooks, ...colocatedHooks }
      })
  """

  use Phoenix.Component

  attr(:id, :string, required: true, doc: "DOM id; must be unique on the page.")

  attr(:src, :string,
    required: true,
    doc: """
    URL of the image to display.

    The default behavior treats `src` as a plain image URL. Extensions can
    register source providers via `window.Fresco.registerSourceProvider/2`
    to intercept specific URL patterns; the bundled engine handles
    `{type: "image"}` sources and throws a clear error for anything else
    (Tessera-style tile sources are planned for a later release).
    """
  )

  attr(:class, :string, default: "w-full h-96", doc: "CSS classes for the viewer container.")

  attr(:infinite_canvas, :boolean,
    default: false,
    doc: """
    When `true`, drops the default "image must cover viewport" clamp so the
    user can pan freely beyond the image edges and zoom out until the image
    is a thumbnail in the middle of an empty canvas. The viewer's
    background dot-grid (always present) becomes visible in the void around
    the image so it reads as "canvas," not "broken layout." Default
    `false` keeps the stock single-image viewer behavior — pan stays
    location-locked inside the image, zoom-out floor is fit-to-viewport.

    Pairs naturally with future layered overlays (e.g. Etcher annotations)
    that need to draw shapes, callouts, or labels in the white space
    around the image, Figma/Miro/Excalidraw style.
    """
  )

  attr(:theme, :atom,
    values: [:system, :light, :dark, :inherit],
    default: :system,
    doc: """
    Color scheme for the viewer host background, dot grid, and nav
    buttons.

    - `:system` (default) — follow the OS / browser `prefers-color-scheme`.
    - `:light` — force light palette regardless of OS preference.
    - `:dark` — force dark palette regardless of OS preference.
    - `:inherit` — emit only the host structure; the parent app's CSS
      supplies the six `--fresco-*` custom properties. Use this to wire
      Fresco to a parent theme system (daisyUI, custom palettes, …).

    Theming is implemented as CSS custom properties on `.fresco-viewer`
    (`--fresco-bg`, `--fresco-grid-dot`, `--fresco-nav-bg`,
    `--fresco-nav-bg-hover`, `--fresco-nav-fg`, `--fresco-nav-focus`).
    """
  )

  attr(:zoom_floor, :float,
    default: nil,
    doc: """
    Optional minimum zoom scale, in engine units (screen-px-per-image-px).
    When set, the engine clamps every zoom path — wheel, pinch,
    double-click, `fitBounds` — at this floor. `nil` (default) falls
    through to the engine's normal floor (`sFit` in clamped mode,
    `sFit * 0.05` in `:infinite_canvas` mode).

    Consumers can also set this at runtime via
    `handle.setZoomFloor(scale)` — useful when the floor depends on
    state that's known only after mount (e.g. a paged reader recomputing
    the floor each time the user navigates to a new page).
    """
  )

  attr(:zoom_ceiling, :float,
    default: nil,
    doc: """
    Optional maximum zoom scale. Symmetric to `:zoom_floor`. `nil`
    (default) uses the engine's default ceiling (8× natural pixel ratio
    capped by the 8192-px raster safety limit).
    """
  )

  attr(:pan_locked, :boolean,
    default: false,
    doc: """
    When `true`, single-pointer pan gestures (mouse drag, touch drag,
    arrow keys) are suppressed. Two-pointer pinch still works for
    zoom. Useful for paged readers that want the page statically
    centered at fit and only allow pan once the user has zoomed in.

    Toggle at runtime via `handle.setPanLocked(true|false)` — typically
    in response to a `handle.on("zoom", …)` subscription that flips
    the lock as the user crosses the fit threshold.
    """
  )

  attr(:gestures, :list,
    default: nil,
    doc: """
    Allowlist of enabled gestures. Atom list:
    `[:pan, :pinch, :wheel, :double_click, :keyboard]`. Default `nil`
    enables all. Omitted entries are disabled.

    `:wheel` covers everything that arrives as a wheel event: a notch of a
    mouse wheel zooms, two fingers on a trackpad move the picture (that
    one needs `:pan` too), and a pinch zooms. See `Fresco.Canvas.canvas/1`
    for the full story.
    """
  )

  attr(:nav_buttons, :list,
    default: nil,
    doc: """
    Allowlist of enabled built-in nav buttons. Atom list:
    `[:home, :zoom_in, :zoom_out, :rotate, :rotate_left, :fullscreen]`.

    `:rotate` rotates clockwise (+90); `:rotate_left` is its
    counter-clockwise twin (-90), rendered just before it.

    - `nil` (default) — every button enabled (both rotate directions).
    - `[]` — every button **hidden**. Useful for consumers building
      their own chrome; wire your buttons to
      `handle.zoomIn()` / `handle.zoomOut()` /
      `handle.rotateRight()` / `handle.rotateLeft()` (or
      `handle.rotateBy(±90)`) / `handle.toggleFullscreen()` /
      `handle.requestHome()` to get identical behavior to the built-ins.
    - A subset list — only those buttons render.
    """
  )

  attr(:initial_rotation, :integer,
    default: 0,
    doc: """
    Initial rotation in degrees, snapped to one of `{0, 90, 180, 270}`
    at mount time. Pre-0.5.7 behavior (no rotation) corresponds to
    `0`. Consumers persisting a per-image rotation choice server-
    side pass it here so the first paint already shows the rotated
    content — no flash of unrotated → rotated.

    Runtime control via `handle.setRotation(deg)` /
    `handle.rotateBy(delta)`, or the named quarter-turn helpers
    `handle.rotateRight()` (+90) / `handle.rotateLeft()` (-90) —
    the twins of the `:rotate` / `:rotate_left` nav buttons. Every
    one fires the `rotate` event, so with `persist_rotation` they all
    save the same way.
    """
  )

  attr(:persist_rotation, :boolean,
    default: false,
    doc: """
    Forwards the client-side `rotate` event to the server so a host can
    **persist** the user's chosen rotation. When `true`, the `FrescoViewer`
    hook pushes a `"fresco:rotate"` LiveView event on every rotation change
    (rotate button, `handle.setRotation/rotateBy`, and the Reset-view snap
    back to home). Defaults to `false` so consumers who don't persist pay
    nothing — this is the only server round-trip Fresco makes.

    The event routes to whichever LiveView or LiveComponent owns the viewer
    element (standard hook `pushEvent` targeting). Payload:

        # handle_event("fresco:rotate", %{"id" => id, "rotation" => deg,
        #                                 "previous" => prev}, socket)

    `id` is the viewer element id (disambiguates multiple viewers);
    `rotation`/`previous` are degrees in `{0, 90, 180, 270}`. Pair with
    `:initial_rotation` (seed the saved angle on mount) to round-trip a
    persisted rotation.
    """
  )

  attr(:rest, :global)

  @doc """
  Renders a Fresco viewer for the given image source.

  Companion JS hook attaches gesture handlers, fits the image to the
  viewport, and publishes the handle for peer extensions.
  """
  def viewer(assigns) do
    assigns =
      assigns
      |> assign(:gestures_csv, atoms_to_csv(assigns[:gestures]))
      |> assign(:nav_buttons_csv, atoms_to_csv(assigns[:nav_buttons]))

    ~H"""
    <div
      id={@id}
      phx-hook="FrescoViewer"
      phx-update="ignore"
      data-src={@src}
      data-infinite-canvas={to_string(@infinite_canvas)}
      data-fresco-theme={to_string(@theme)}
      data-zoom-floor={@zoom_floor && to_string(@zoom_floor)}
      data-zoom-ceiling={@zoom_ceiling && to_string(@zoom_ceiling)}
      data-pan-locked={@pan_locked && "true"}
      data-gestures={@gestures_csv}
      data-nav-buttons={@nav_buttons_csv}
      data-initial-rotation={@initial_rotation != 0 && to_string(@initial_rotation)}
      data-persist-rotation={@persist_rotation && "true"}
      class={[
        "fresco-viewer",
        @class,
        @infinite_canvas && "fresco-viewer--infinite"
      ]}
      tabindex="0"
      {@rest}
    >
      <div class="fresco-stage" data-fresco-stage>
        <img src={@src} alt="" draggable="false" data-fresco-img />
      </div>
    </div>
    """
  end

  defp atoms_to_csv(nil), do: nil
  # Explicit empty list → "none" sentinel. Lets consumers pass
  # `nav_buttons: []` (or `gestures: []`) to hide the whole group;
  # the JS side reads `data-*="none"` and seeds an empty allowlist
  # (vs the omitted-attr case which defaults to "all enabled").
  defp atoms_to_csv([]), do: "none"

  defp atoms_to_csv(list) when is_list(list) do
    list
    |> Enum.map(&Atom.to_string/1)
    |> Enum.join(",")
  end
end
