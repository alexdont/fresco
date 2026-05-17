defmodule FrescoTest do
  use ExUnit.Case
  doctest Fresco

  import Phoenix.LiveViewTest

  describe "Fresco.viewer/1" do
    test "renders a div with the FrescoViewer hook and data-src" do
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

    test "rotate flips the data-rotate attribute on the host" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg", rotate: true)
      assert html =~ ~s(data-rotate="true")
    end

    test "sources renders a JSON payload on data-sources" do
      html =
        render_component(&Fresco.viewer/1,
          id: "v",
          sources: [%{src: "/a.jpg"}, %{src: "/b.jpg", x: 1.1}]
        )

      assert html =~ ~s(data-sources=)
      # Two source entries serialized in order; presence checks are
      # enough — JS hook is the contract for the exact shape.
      assert html =~ ~s(/a.jpg)
      assert html =~ ~s(/b.jpg)
    end

    test "pan_optimized defaults to false on the host" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg")
      assert html =~ ~s(data-pan-optimized="false")
    end

    test "pan_optimized=true plumbs through to the host" do
      html = render_component(&Fresco.viewer/1, id: "v", src: "/x.jpg", pan_optimized: true)
      assert html =~ ~s(data-pan-optimized="true")
    end

    test "raises ArgumentError when both :src and :sources are missing" do
      assert_raise ArgumentError, ~r/requires either :src/, fn ->
        render_component(&Fresco.viewer/1, id: "v")
      end
    end
  end
end
