defmodule Fresco.ExportLayerTest do
  @moduledoc """
  Export layers (`handle.addExportLayer/1`): what an extension draws over the
  pictures (Etcher's shapes) joins the PDF. Lifts the helpers out of the
  bundle and runs them under node. Skipped without node.
  """
  use ExUnit.Case, async: true

  @source Path.expand("../../priv/static/fresco.js", __DIR__)

  defp lift(src, head) do
    start = :binary.match(src, head) |> elem(0)
    rest = binary_part(src, start, byte_size(src) - start)
    binary_part(rest, 0, :binary.match(rest, "\n  }\n") |> elem(0)) <> "\n  }\n"
  end

  defp run(body) do
    src = File.read!(@source)

    js = """
    #{lift(src, "  function exportLayerEntries(")}
    #{lift(src, "  function addExportLayer(")}
    #{lift(src, "  function exportName(")}
    (async function () {
    #{body}
    })().catch(function (e) { console.log("UNCAUGHT " + e.message); });
    """

    path = Path.join(System.tmp_dir!(), "fresco_layer_#{System.unique_integer([:positive])}.js")
    File.write!(path, js)

    try do
      {out, 0} = System.cmd(System.find_executable("node"), [path], stderr_to_stdout: true)
      String.trim(out)
    after
      File.rm(path)
    end
  end

  defp node?, do: System.find_executable("node") != nil

  test "layers are asked at export time, in the order they were added" do
    if node?() do
      out =
        run("""
        var el = {};
        addExportLayer(el, function (o) { return [{ src: "data:a", x: 1, y: 2, width: 3, height: 4 }]; });
        var remove = addExportLayer(el, function () { return Promise.resolve({ src: "data:b", x: 0, y: 0, width: 1, height: 1 }); });
        addExportLayer(el, function () { return null; });
        var got = await exportLayerEntries(el, {});
        console.log(got.map(function (e) { return e.src; }).join(","));
        remove();
        got = await exportLayerEntries(el, {});
        console.log(got.map(function (e) { return e.src; }).join(","));
        console.log((await exportLayerEntries({}, {})).length);
        """)

      assert out == "data:a,data:b\ndata:a\n0"
    end
  end

  test "a layer that fails fails the export" do
    if node?() do
      out =
        run("""
        var el = {};
        addExportLayer(el, function () { throw new Error("boom"); });
        try { await exportLayerEntries(el, {}); console.log("resolved"); }
        catch (e) { console.log("rejected " + e.message); }
        """)

      assert out == "rejected boom"
    end
  end

  test "a drawn layer never names the file" do
    if node?() do
      out =
        run("""
        var svg = { src: "data:image/svg+xml;charset=utf-8,%3Csvg%3E" };
        console.log(exportName({ dataset: {} }, [svg]));
        console.log(exportName({ dataset: {} }, [svg, { src: "/files/cat.jpg?v=1" }]));
        console.log(exportName({ dataset: { exportFilename: "Board: Q3" } }, [svg]));
        """)

      assert out == "picture.pdf\ncat.pdf\nBoard_ Q3.pdf"
    end
  end
end
