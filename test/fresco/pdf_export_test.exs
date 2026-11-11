defmodule Fresco.PdfExportTest do
  @moduledoc """
  "Export as PDF" (`pdf_export`): the bundle's own writer makes a one-page PDF
  holding the picture as a JPEG. A PDF reader finds its objects by byte
  offset, so the cross-reference table has to be exact — this checks every
  offset against the bytes, the page orientation, and that the JPEG goes in
  unchanged. The writer is lifted out of the bundle and run under node.
  Skipped without node.
  """
  use ExUnit.Case, async: true

  import Phoenix.LiveViewTest, only: [rendered_to_string: 1]
  import Phoenix.Component, only: [sigil_H: 2]

  @source Path.expand("../../priv/static/fresco.js", __DIR__)

  defp lift(src, head) do
    start = :binary.match(src, head) |> elem(0)
    rest = binary_part(src, start, byte_size(src) - start)
    binary_part(rest, 0, :binary.match(rest, "\n  }\n") |> elem(0)) <> "\n  }\n"
  end

  # Runs the writer on fake JPEG bytes and returns the PDF.
  defp pdf(w, h, title) do
    src = File.read!(@source)

    js = """
    #{lift(src, "  function pdfText(")}
    #{lift(src, "  function pdfFromJpeg(")}
    var jpeg = new Uint8Array([0xFF, 0xD8, 1, 2, 3, 0x0A, 0x0D, 4, 0xFF, 0xD9]);
    var out = pdfFromJpeg(jpeg, #{w}, #{h}, #{Jason.encode!(title)});
    process.stdout.write(Buffer.from(out).toString("base64"));
    """

    path = Path.join(System.tmp_dir!(), "fresco_pdf_#{System.unique_integer([:positive])}.js")
    File.write!(path, js)

    try do
      {out, 0} = System.cmd(System.find_executable("node"), [path], stderr_to_stdout: true)
      Base.decode64!(out)
    after
      File.rm(path)
    end
  end

  defp node?, do: System.find_executable("node") != nil

  test "every cross-reference offset lands on its object" do
    if node?() do
      bytes = pdf(1200, 800, "Matcha – латте")
      assert binary_part(bytes, 0, 8) == "%PDF-1.4"

      [_, xref_at] = Regex.run(~r/startxref\n(\d+)\n%%EOF\n$/, bytes)
      xref_at = String.to_integer(xref_at)
      assert binary_part(bytes, xref_at, 4) == "xref"

      table = binary_part(bytes, xref_at, byte_size(bytes) - xref_at)
      offsets = Regex.scan(~r/^(\d{10}) 00000 n $/m, table) |> Enum.map(fn [_, o] -> String.to_integer(o) end)
      assert length(offsets) == 6

      offsets
      |> Enum.with_index(1)
      |> Enum.each(fn {o, n} ->
        assert binary_part(bytes, o, byte_size("#{n} 0 obj")) == "#{n} 0 obj"
      end)
    end
  end

  test "a wide picture gets a landscape page, a tall one portrait, fitted inside a margin" do
    if node?() do
      assert pdf(1200, 800, "w") =~ "/MediaBox [0 0 841.89 595.28]"
      assert pdf(800, 1200, "t") =~ "/MediaBox [0 0 595.28 841.89]"
    end
  end

  test "the JPEG goes in unchanged, at its own size, with the title in any language" do
    if node?() do
      bytes = pdf(1200, 800, "Matcha – латте")
      assert bytes =~ "/Width 1200 /Height 800"
      assert bytes =~ "/Filter /DCTDecode /Length 10"
      assert :binary.match(bytes, <<0xFF, 0xD8, 1, 2, 3, 0x0A, 0x0D, 4, 0xFF, 0xD9>>) != :nomatch
      # UTF-16BE: "M" then the Cyrillic "л".
      assert bytes =~ "/Title <FEFF004D"
      assert bytes =~ "043B"
    end
  end

  test "the button is opt-in and collapses into the overflow first" do
    src = File.read!(@source)
    assert src =~ ~s(var NAV_COLLAPSE = ["export_pdf",)
    assert src =~ ~s|if (enabled("export_pdf") && handlers.onExportPdf)|
    assert src =~ ~s|onExportPdf: attrOpts.pdfExport ?|
    assert src =~ ~s|onExportPdf: canvasAttrOpts.pdfExport ?|
  end

  test "a host's high-resolution copy is what gets exported" do
    canvas = Fresco.Canvas.new(width: 100, height: 100)
    canvas = Fresco.Canvas.add_image(canvas, %{src: "/medium.jpg", export_src: "/original.jpg", x: 0, y: 0, width: 100})
    assert [%{export_src: "/original.jpg"}] = canvas.images
    assigns = %{canvas: canvas}
    html = rendered_to_string(~H|<Fresco.canvas id="c" canvas={@canvas} pdf_export />|)
    assert html =~ ~s(data-export-src="/original.jpg")
    assert File.read!(@source) =~ "im.dataset.exportSrc || im.currentSrc"
  end

  test "the attribute reaches the element" do
    assigns = %{}

    on =
      rendered_to_string(~H"""
      <Fresco.viewer id="v" src="/x.jpg" pdf_export export_filename="Shelf" />
      """)

    assert on =~ ~s(data-pdf-export="true")
    assert on =~ ~s(data-export-filename="Shelf")

    off = rendered_to_string(~H|<Fresco.viewer id="v" src="/x.jpg" />|)
    refute off =~ "data-pdf-export"
  end

  describe "nav_style: :bar (one look with Etcher's tool bar)" do
    test "the attribute reaches the element, and only when asked for" do
      assigns = %{}
      assert rendered_to_string(~H|<Fresco.viewer id="v" src="/x.jpg" nav_style={:bar} />|) =~
               ~s(data-nav-style="bar")

      refute rendered_to_string(~H|<Fresco.viewer id="v" src="/x.jpg" />|) =~ "data-nav-style"
    end

    test "the nav and its overflow popover take the bar look; the buttons inside are Etcher's" do
      src = File.read!(@source)
      assert src =~ ~s|if (opts && opts.style === "bar") nav.setAttribute("data-style", "bar");|
      assert src =~ ~s|if (nav.getAttribute("data-style")) pop.setAttribute("data-style"|
      assert src =~ ~s|background: rgba(0, 0, 0, 0.7); border-radius: 10px; padding: 6px; gap: 6px;|
      assert src =~ ~s|.fresco-nav[data-style=\\"bar\\"] button:hover { background: rgba(255, 255, 255, 0.12); }|
      assert src =~ ~s|navStyle: attrOpts.navStyle,|
      assert src =~ ~s|navStyle: canvasAttrOpts.navStyle,|
    end
  end
end
