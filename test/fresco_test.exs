defmodule FrescoTest do
  use ExUnit.Case
  doctest Fresco

  import Phoenix.LiveViewTest

  describe "Fresco.viewer/1" do
    test "renders the host div with the FrescoViewer hook and data-src" do
      html =
        render_component(&Fresco.viewer/1,
          id: "test-viewer",
          src: "/uploads/photo.jpg",
          class: "w-full h-96"
        )

      assert html =~ ~s(id="test-viewer")
      assert html =~ ~s(phx-hook="FrescoViewer")
      assert html =~ ~s(data-src="/uploads/photo.jpg")
      # `fresco-viewer` is auto-added so the default dot-grid
      # background rule has a hook; the caller's classes follow.
      assert html =~ ~s(class="fresco-viewer w-full h-96")
      # `infinite_canvas` defaults to false; the modifier class
      # should NOT be on the host in stock mode.
      refute html =~ "fresco-viewer--infinite"
    end

    test "renders the .fresco-stage div inside the host" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg")
      # The stage is the transformed surface. The hook reads it via
      # [data-fresco-stage]; the class hooks the CSS rules.
      assert html =~ ~s(class="fresco-stage")
      assert html =~ "data-fresco-stage"
    end

    test "server-renders the <img> inside the stage with the given src" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/uploads/cat.jpg")
      # No JS flash before mount: the image is in the DOM as soon as
      # the markup hits the page. `draggable=false` keeps the browser
      # from initiating its own drag-image ghost.
      assert html =~ ~s(src="/uploads/cat.jpg")
      assert html =~ ~s(draggable="false")
      assert html =~ "data-fresco-img"
    end

    test "host carries tabindex=0 so keyboard handlers fire after focus" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg")
      assert html =~ ~s(tabindex="0")
    end

    test "passes global attributes through :rest" do
      html =
        render_component(&Fresco.viewer/1,
          id: "v",
          src: "/x.jpg",
          "data-extra": "yes"
        )

      assert html =~ ~s(data-extra="yes")
    end

    test "default theme is :system" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg")
      assert html =~ ~s(data-fresco-theme="system")
    end

    test "theme :light pins the host to a fixed-light palette" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg", theme: :light)
      assert html =~ ~s(data-fresco-theme="light")
    end

    test "theme :dark pins the host to a fixed-dark palette" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg", theme: :dark)
      assert html =~ ~s(data-fresco-theme="dark")
    end

    test "theme :inherit emits no fresco-supplied palette so parent CSS wins" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg", theme: :inherit)
      assert html =~ ~s(data-fresco-theme="inherit")
    end

    test "infinite_canvas adds the modifier class on the host" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg", infinite_canvas: true)
      assert html =~ "fresco-viewer--infinite"
      assert html =~ ~s(data-infinite-canvas="true")
    end

    test "zoom_floor / zoom_ceiling / pan_locked default to omitted attrs (no behavior change)" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg")
      refute html =~ "data-zoom-floor"
      refute html =~ "data-zoom-ceiling"
      refute html =~ "data-pan-locked"
    end

    test "zoom_floor renders the data attribute" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg", zoom_floor: 0.5)
      assert html =~ ~s(data-zoom-floor="0.5")
    end

    test "zoom_ceiling renders the data attribute" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg", zoom_ceiling: 4.0)
      assert html =~ ~s(data-zoom-ceiling="4.0")
    end

    test "pan_locked=true renders data-pan-locked=\"true\"" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg", pan_locked: true)
      assert html =~ ~s(data-pan-locked="true")
    end

    test "gestures / nav_buttons default to omitted (back-compat)" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg")
      refute html =~ "data-gestures"
      refute html =~ "data-nav-buttons"
      refute html =~ "data-initial-rotation"
    end

    test "initial_rotation defaults to 0 (omitted from DOM)" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg", initial_rotation: 0)
      refute html =~ "data-initial-rotation"
    end

    test "initial_rotation renders the data attribute when non-zero" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg", initial_rotation: 90)
      assert html =~ ~s(data-initial-rotation="90")
    end

    test "empty nav_buttons list renders the `none` sentinel (hide every button)" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg", nav_buttons: [])
      assert html =~ ~s(data-nav-buttons="none")
    end

    test "empty gestures list renders the `none` sentinel (explicit hide-all)" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg", gestures: [])
      assert html =~ ~s(data-gestures="none")
    end

    test "gestures renders CSV of atom names" do
      html =
        render_component(&Fresco.viewer/1,
          id: "v",
          src: "/x.jpg",
          gestures: [:pan, :pinch, :wheel]
        )

      assert html =~ ~s(data-gestures="pan,pinch,wheel")
    end

    test "nav_buttons renders CSV of atom names" do
      html =
        render_component(&Fresco.viewer/1,
          id: "v",
          src: "/x.jpg",
          nav_buttons: [:zoom_in, :zoom_out, :home]
        )

      assert html =~ ~s(data-nav-buttons="zoom_in,zoom_out,home")
    end
  end

  describe "Fresco.canvas/1" do
    defp build_canvas(opts \\ []) do
      width = Keyword.get(opts, :width, 4000)
      height = Keyword.get(opts, :height, 3000)
      images = Keyword.get(opts, :images, [])
      background = Keyword.get(opts, :background)
      extensions = Keyword.get(opts, :extensions, %{})

      canvas = Fresco.Canvas.new(width: width, height: height, background: background)

      canvas =
        Enum.reduce(images, canvas, fn img, acc -> Fresco.Canvas.add_image(acc, img) end)

      Enum.reduce(extensions, canvas, fn {k, v}, acc ->
        Fresco.Canvas.put_extension(acc, k, v)
      end)
    end

    test "renders the host with the FrescoCanvas hook and canvas data attrs" do
      canvas =
        build_canvas(
          width: 4000,
          height: 3000,
          images: [%{src: "/a.jpg", x: 0, y: 0, width: 2000}]
        )

      html = render_component(&Fresco.canvas/1, id: "board", canvas: canvas)

      assert html =~ ~s(id="board")
      assert html =~ ~s(phx-hook="FrescoCanvas")
      assert html =~ ~s(data-canvas-width="4000")
      assert html =~ ~s(data-canvas-height="3000")
      assert html =~ ~s(tabindex="0")
      assert html =~ ~s(class="fresco-viewer w-full h-96")
    end

    test "renders one <img> per image with the canvas-pixel data attrs" do
      canvas =
        build_canvas(
          images: [
            %{src: "/a.jpg", x: 0, y: 0, width: 2000},
            %{src: "/b.jpg", x: 2100, y: 0, width: 1800}
          ]
        )

      html = render_component(&Fresco.canvas/1, id: "board", canvas: canvas)

      assert html =~ ~s(src="/a.jpg")
      assert html =~ ~s(src="/b.jpg")
      assert html =~ ~s(data-fresco-canvas-img)
      assert html =~ ~s(data-image-id="img-1")
      assert html =~ ~s(data-image-id="img-2")
      assert html =~ ~s(data-canvas-x="0")
      assert html =~ ~s(data-canvas-x="2100")
      assert html =~ ~s(data-canvas-width="2000")
      assert html =~ ~s(data-canvas-width="1800")
    end

    test "renders the .fresco-stage div inside the host" do
      canvas = build_canvas(images: [%{src: "/a.jpg", x: 0, y: 0, width: 100}])
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas)
      assert html =~ ~s(class="fresco-stage")
      assert html =~ "data-fresco-stage"
    end

    test "empty images list renders an empty stage (no crash, no imgs)" do
      canvas = build_canvas(images: [])
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas)
      assert html =~ "fresco-stage"
      refute html =~ "data-fresco-canvas-img"
    end

    test "nil :canvas raises (Phoenix.Component enforces the struct attr type)" do
      assert_raise FunctionClauseError, fn ->
        render_component(&Fresco.canvas/1, id: "b", canvas: nil)
      end
    end

    test "natural_width + natural_height carry the aspect through to the engine" do
      canvas =
        build_canvas(
          images: [
            %{src: "/a.jpg", x: 0, y: 0, width: 1000, natural_width: 2000, natural_height: 1500}
          ]
        )

      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas)
      # 1000 * 1500 / 2000 = 750
      assert html =~ ~s(data-canvas-height="750.0")
    end

    test "a lone image paints CSS-contained before the engine mounts" do
      # The markup is on screen for the whole gap between the static render
      # and the hook mounting — a second or more on a cold load, and all of
      # it if the bundle fails. Canvas-PIXEL sizes there meant a 4000px-wide
      # photo painted as a magnified corner, and squashed out of proportion
      # under a reset that clamps width but not height (Tailwind preflight).
      # Contained against the viewer, that first paint is the whole picture.
      canvas =
        build_canvas(
          images: [
            %{src: "/a.jpg", x: 0, y: 0, width: 4000, natural_width: 4000, natural_height: 3000}
          ]
        )

      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas)

      assert html =~ "object-fit:contain;", "the pre-mount paint should fit, not crop"
      assert html =~ "max-width:100%; max-height:100%;", "…and stay inside the viewer"

      refute html =~ "width:4000px;",
             "canvas-pixel sizing in the markup is the magnified first paint this replaced"

      # Percentages need a box to resolve against; the stage shrink-wraps its
      # content otherwise. The engine clears this when it takes over.
      assert html =~ ~s(data-fresco-stage style="width:100%; height:100%;")

      # The bundle's pre-fit hiding rule must not blank this paint: it exists
      # to suppress raw canvas-pixel sizes, which this image does not have.
      assert html =~ ~s(data-fresco-prefit="true")
    end

    test "a lone image smaller than its canvas keeps canvas-pixel sizing" do
      # The preview fills the viewer; the engine fits the whole CANVAS, which
      # for an image occupying part of it is a different picture. Painting one
      # and then jumping to the other is worse than waiting.
      canvas =
        build_canvas(
          images: [
            %{src: "/a.jpg", x: 0, y: 0, width: 1000, natural_width: 2000, natural_height: 1500}
          ]
        )

      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas)

      assert html =~ "width:1000px;", "canvas is 4000 wide — this image is not the canvas"
      refute html =~ "object-fit:contain;"
      refute html =~ "data-fresco-prefit"
    end

    test "a multi-image board keeps canvas-pixel sizing" do
      # "Contain each image in the viewer" would stack every image of a board
      # on top of every other — worse than the magnified corner it fixes.
      canvas =
        build_canvas(
          images: [
            %{src: "/a.jpg", x: 0, y: 0, width: 1000, natural_width: 2000, natural_height: 1500},
            %{src: "/b.jpg", x: 1200, y: 0, width: 1000}
          ]
        )

      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas)

      assert html =~ "width:1000px;"
      assert html =~ "left:1200px;"
      refute html =~ "object-fit:contain;"
      refute html =~ ~s(data-fresco-stage style="width:100%)
      refute html =~ "data-fresco-prefit"
    end

    test "z_index plumbs through and sorts render order" do
      # Two imgs with explicit z_index — the second one should come first in
      # render order (sorted ascending by z_index).
      canvas =
        build_canvas(
          images: [
            %{src: "/top.jpg", x: 0, y: 0, width: 100, z_index: 10},
            %{src: "/bottom.jpg", x: 0, y: 0, width: 100, z_index: 0}
          ]
        )

      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas)
      assert html =~ "z-index:10;"
      assert html =~ "z-index:0;"

      bottom_idx = :binary.match(html, "/bottom.jpg") |> elem(0)
      top_idx = :binary.match(html, "/top.jpg") |> elem(0)
      assert bottom_idx < top_idx, "lower z_index should render first in DOM order"
    end

    test "canvas.background sets inline background-color on the stage" do
      canvas = build_canvas(background: "#fafafa")
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas)
      assert html =~ ~s|style="background-color: #fafafa;"|
    end

    test "extensions are JSON-encoded onto data-extensions for the JS hook" do
      canvas = build_canvas(extensions: [{"etcher", %{"annotations" => []}}])
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas)
      assert html =~ ~s(data-extensions=)
      assert html =~ ~s(etcher)
    end

    test "infinite_canvas adds the modifier class on the host" do
      canvas = build_canvas()
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas, infinite_canvas: true)
      assert html =~ "fresco-viewer--infinite"
      assert html =~ ~s(data-infinite-canvas="true")
    end

    test "theme :system is the default" do
      canvas = build_canvas()
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas)
      assert html =~ ~s(data-fresco-theme="system")
    end

    test "theme overrides plumb through" do
      canvas = build_canvas()

      for theme <- [:light, :dark, :inherit] do
        html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas, theme: theme)
        assert html =~ ~s(data-fresco-theme="#{theme}")
      end
    end

    test "passes :rest global attrs through to the host" do
      canvas = build_canvas()
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas, "data-extra": "yes")
      assert html =~ ~s(data-extra="yes")
    end

    test "zoom_floor / zoom_ceiling / pan_locked default to omitted attrs (no behavior change)" do
      canvas = build_canvas()
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas)
      refute html =~ "data-zoom-floor"
      refute html =~ "data-zoom-ceiling"
      refute html =~ "data-pan-locked"
    end

    test "zoom_floor renders the data attribute" do
      canvas = build_canvas()
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas, zoom_floor: 0.5)
      assert html =~ ~s(data-zoom-floor="0.5")
    end

    test "zoom_ceiling renders the data attribute" do
      canvas = build_canvas()
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas, zoom_ceiling: 4.0)
      assert html =~ ~s(data-zoom-ceiling="4.0")
    end

    test "pan_locked=true renders data-pan-locked=\"true\"" do
      canvas = build_canvas()
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas, pan_locked: true)
      assert html =~ ~s(data-pan-locked="true")
    end

    test "initial_fit_image_id / initial_fit_bounds / memory_window / gestures / nav_buttons default to omitted" do
      canvas = build_canvas()
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas)
      refute html =~ "data-initial-fit-image-id"
      refute html =~ "data-initial-fit-bounds"
      refute html =~ "data-memory-window"
      refute html =~ "data-gestures"
      refute html =~ "data-nav-buttons"
      refute html =~ "data-initial-rotation"
    end

    test "initial_rotation defaults to 0 and is omitted from the DOM" do
      canvas = build_canvas()
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas, initial_rotation: 0)
      refute html =~ "data-initial-rotation"
    end

    test "initial_rotation renders the data attribute when non-zero" do
      canvas = build_canvas()

      html =
        render_component(&Fresco.canvas/1, id: "b", canvas: canvas, initial_rotation: 90)

      assert html =~ ~s(data-initial-rotation="90")
    end

    test "initial_fit_image_id renders the data attribute" do
      canvas = build_canvas(images: [%{src: "/a.jpg", x: 0, y: 0, width: 100}])

      html =
        render_component(&Fresco.canvas/1,
          id: "b",
          canvas: canvas,
          initial_fit_image_id: "img-1"
        )

      assert html =~ ~s(data-initial-fit-image-id="img-1")
    end

    test "initial_fit_bounds renders JSON-encoded bounds" do
      canvas = build_canvas()

      html =
        render_component(&Fresco.canvas/1,
          id: "b",
          canvas: canvas,
          initial_fit_bounds: %{x: 100, y: 200, width: 300, height: 400}
        )

      # HEEx HTML-escapes the JSON quotes; assert against the escaped form.
      assert html =~ "data-initial-fit-bounds="
      assert html =~ ~s(&quot;x&quot;:100)
      assert html =~ ~s(&quot;y&quot;:200)
      assert html =~ ~s(&quot;width&quot;:300)
      assert html =~ ~s(&quot;height&quot;:400)
    end

    test "memory_window renders the data attribute" do
      canvas = build_canvas()
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas, memory_window: 2)
      assert html =~ ~s(data-memory-window="2")
    end

    test "gestures renders CSV of atom names" do
      canvas = build_canvas()

      html =
        render_component(&Fresco.canvas/1,
          id: "b",
          canvas: canvas,
          gestures: [:pan, :pinch, :wheel]
        )

      assert html =~ ~s(data-gestures="pan,pinch,wheel")
    end

    test "nav_buttons renders CSV of atom names" do
      canvas = build_canvas()

      html =
        render_component(&Fresco.canvas/1,
          id: "b",
          canvas: canvas,
          nav_buttons: [:zoom_in, :zoom_out, :home]
        )

      assert html =~ ~s(data-nav-buttons="zoom_in,zoom_out,home")
    end

    test "empty gestures list renders the `none` sentinel (explicit hide-all)" do
      canvas = build_canvas()
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas, gestures: [])
      assert html =~ ~s(data-gestures="none")
    end

    test "empty nav_buttons list renders the `none` sentinel (hide every button)" do
      canvas = build_canvas()
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas, nav_buttons: [])
      assert html =~ ~s(data-nav-buttons="none")
    end

    test "view-tracking attrs default to omitted" do
      canvas = build_canvas()
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas)
      refute html =~ "data-view-tracking"
      refute html =~ "data-view-settle-ms"
      refute html =~ "data-view-threshold"
    end

    test "view_tracking=true renders all three data attrs with defaults" do
      canvas = build_canvas()
      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas, view_tracking: true)
      assert html =~ ~s(data-view-tracking="true")
      assert html =~ ~s(data-view-settle-ms="150")
      assert html =~ ~s(data-view-threshold="0.5")
    end

    test "view_settle_ms / view_threshold render only when view_tracking is on" do
      canvas = build_canvas()

      html =
        render_component(&Fresco.canvas/1,
          id: "b",
          canvas: canvas,
          view_tracking: true,
          view_settle_ms: 250,
          view_threshold: 0.7
        )

      assert html =~ ~s(data-view-settle-ms="250")
      assert html =~ ~s(data-view-threshold="0.7")
    end

    test "view_settle_ms / view_threshold are inert when view_tracking is off (no data attrs)" do
      canvas = build_canvas()

      html =
        render_component(&Fresco.canvas/1,
          id: "b",
          canvas: canvas,
          view_settle_ms: 999,
          view_threshold: 0.9
        )

      refute html =~ "data-view-tracking"
      refute html =~ "data-view-settle-ms"
      refute html =~ "data-view-threshold"
    end
  end
end
