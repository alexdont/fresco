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

    test "natural_width + natural_height set inline height to preserve aspect pre-mount" do
      canvas =
        build_canvas(
          images: [
            %{src: "/a.jpg", x: 0, y: 0, width: 1000, natural_width: 2000, natural_height: 1500}
          ]
        )

      html = render_component(&Fresco.canvas/1, id: "b", canvas: canvas)
      # 1000 * 1500 / 2000 = 750
      assert html =~ ~s(data-canvas-height="750.0")
      assert html =~ "height:750.0px;"
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
  end

  describe "Fresco.scroll_strip/1" do
    @one_src [%{url: "/img/p1.jpg", width: 720, height: 9000}]

    test "renders one <img> per source inside the strip container" do
      html =
        render_component(&Fresco.scroll_strip/1,
          id: "test-strip",
          sources: [
            %{url: "/img/p1.jpg", width: 720, height: 9000},
            %{url: "/img/p2.jpg", width: 720, height: 8500}
          ]
        )

      assert html =~ ~s(id="test-strip")
      assert html =~ ~s(phx-hook="FrescoScrollStrip")
      assert html =~ ~s(src="/img/p1.jpg")
      assert html =~ ~s(src="/img/p2.jpg")
      # data-image-idx threaded so the JS hook can hit-test + scroll-to.
      assert html =~ ~s(data-image-idx="0")
      assert html =~ ~s(data-image-idx="1")
    end

    test "inlines aspect-ratio per source so eviction doesn't collapse the slot" do
      html = render_component(&Fresco.scroll_strip/1, id: "s", sources: @one_src)
      # Critical: aspect-ratio in inline style prevents layout shift when
      # the JS hook removes src to evict the image (memory windowing).
      assert html =~ "aspect-ratio: 720 / 9000"
    end

    test "loading=lazy + decoding=async on every <img> for cheap mount" do
      html = render_component(&Fresco.scroll_strip/1, id: "s", sources: @one_src)
      assert html =~ ~s(loading="lazy")
      assert html =~ ~s(decoding="async")
    end

    test "window_before / window_after defaults plumbed to data attrs" do
      html = render_component(&Fresco.scroll_strip/1, id: "s", sources: @one_src)
      assert html =~ ~s(data-window-before="1")
      assert html =~ ~s(data-window-after="3")
    end

    test "snap_to_image=:off (default) emits no scroll-snap modifier class" do
      html = render_component(&Fresco.scroll_strip/1, id: "s", sources: @one_src)
      refute html =~ "fresco-strip--snap-mandatory"
      refute html =~ "fresco-strip--snap-proximity"
      assert html =~ ~s(data-snap="off")
    end

    test "snap_to_image=:mandatory adds the mandatory modifier class" do
      html =
        render_component(&Fresco.scroll_strip/1,
          id: "s",
          sources: @one_src,
          snap_to_image: :mandatory
        )

      assert html =~ "fresco-strip--snap-mandatory"
      assert html =~ ~s(data-snap="mandatory")
    end

    test "gap_px > 0 emits margin-bottom between images (except the last)" do
      html =
        render_component(&Fresco.scroll_strip/1,
          id: "s",
          sources: [
            %{url: "/img/p1.jpg", width: 720, height: 9000},
            %{url: "/img/p2.jpg", width: 720, height: 9000}
          ],
          gap_px: 16
        )

      assert html =~ "margin-bottom: 16px"
      assert html =~ ~s(data-gap-px="16")
    end

    test "sources are JSON-encoded onto data-sources for client-side use" do
      html = render_component(&Fresco.scroll_strip/1, id: "s", sources: @one_src)
      assert html =~ ~s(data-sources=)
      assert html =~ ~s(/img/p1.jpg)
    end

    test "raises ArgumentError on empty :sources" do
      assert_raise ArgumentError, ~r/non-empty :sources/, fn ->
        render_component(&Fresco.scroll_strip/1, id: "s", sources: [])
      end
    end

    test "raises ArgumentError when a source is missing :width" do
      assert_raise ArgumentError, ~r/require :url \(string\), :width/, fn ->
        render_component(&Fresco.scroll_strip/1,
          id: "s",
          sources: [%{url: "/img/p1.jpg", height: 9000}]
        )
      end
    end

    test "raises ArgumentError when a source is missing :url" do
      assert_raise ArgumentError, ~r/require :url \(string\)/, fn ->
        render_component(&Fresco.scroll_strip/1,
          id: "s",
          sources: [%{width: 720, height: 9000}]
        )
      end
    end
  end
end
