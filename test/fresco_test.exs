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
  end
end
