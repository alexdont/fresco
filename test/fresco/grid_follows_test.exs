defmodule Fresco.GridFollowsTest do
  @moduledoc """
  The dot grid is pinned to the canvas: a pan carries it along, a zoom
  spreads it out or draws it in, as if the board lay behind the picture.

  The same dots throughout — none come or go as you zoom. Their spacing is
  fixed in canvas units the first time the grid is painted (24 px apart at
  the opening view) and only scales after that. The one exception is a
  board zoomed out so far the dots would pack into a smear: there the whole
  grid fades, together.

  `syncGrid` is read out of the bundle and run in node against a stub
  element that records the custom properties it sets.
  """
  use ExUnit.Case, async: true

  @source Path.expand("../../priv/static/fresco.js", __DIR__)

  defp lift(src, head) do
    start = :binary.match(src, head) |> elem(0)
    rest = binary_part(src, start, byte_size(src) - start)
    [line | _] = String.split(rest, "\n", parts: 2)

    if String.ends_with?(String.trim_trailing(line), "}") and
         not String.ends_with?(String.trim_trailing(line), "{") do
      line
    else
      binary_part(rest, 0, :binary.match(rest, "\n    }") |> elem(0)) <> "\n    }"
    end
  end

  # `views` is a JS array of [tx, ty, s]; the result is one reading per view.
  defp run(views, opts \\ []) do
    src = File.read!(@source)

    js = """
    var props = {}, attrs = {};
    var el = { style: { setProperty: function(k, v) { props[k] = v; } },
               hasAttribute: function(k) { return k in attrs; },
               setAttribute: function(k, v) { attrs[k] = v; } };
    var tx = 0, ty = 0, s = 1, sHome = #{Keyword.get(opts, :home, 0.5)};
    var gridVisible = #{Keyword.get(opts, :visible, true)};
    var ready = #{Keyword.get(opts, :ready, true)};
    #{Regex.run(~r/    var GRID_PITCH = \d+;/, src) |> hd()}
    #{Regex.run(~r/    var GRID_FADE_FROM = .*;/, src) |> hd()}
    var gridCanvasPitch = null, gridHome = null;
    var gridKey = "";
    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    #{lift(src, "    function syncGrid() {")}
    #{lift(src, "    function mod(a, n) {")}
    var out = #{views}.map(function(v) {
      tx = v[0]; ty = v[1]; s = v[2]; props = {};
      gridKey = "";
      syncGrid();
      var px = function(k) { return k in props ? parseFloat(props[k]) : null; };
      return { pitch: px("--fresco-grid-pitch"), alpha: px("--fresco-grid-alpha"), r: px("--fresco-grid-r"),
               x: px("--fresco-grid-x"), y: px("--fresco-grid-y"), tagged: "data-fresco-grid" in attrs };
    });
    console.log(JSON.stringify(out));
    """

    {out, 0} = System.cmd("node", ["-e", js], stderr_to_stdout: true)
    Jason.decode!(String.trim(out))
  end

  test "24 px apart at the opening view, and the spacing scales exactly with the zoom" do
    # Home is 0.5 here, so the dots are 48 canvas units apart.
    out = run("[[0, 0, 0.5], [0, 0, 1], [0, 0, 2], [0, 0, 0.25], [0, 0, 1.7]]")
    assert Enum.map(out, & &1["pitch"]) == [24.0, 48.0, 96.0, 12.0, 81.6]
  end

  test "the same dots throughout: none appear or vanish anywhere in the zoom range" do
    # From where the dots are about 8.5 px apart (just short of the fade) to 16× in.
    scales = for e <- -15..40, do: 0.5 * :math.pow(2, e / 10)
    out = run(Jason.encode!(Enum.map(scales, &[0, 0, &1])))

    for {g, s} <- Enum.zip(out, scales) do
      assert_in_delta g["pitch"], 48 * s, 0.01
      assert g["alpha"] == 100, "full strength at #{s}"
    end
  end

  test "the spacing is fixed once; a later change of home does not move it" do
    # One run, two homes: the second view must keep the first's spacing.
    src = File.read!(@source)
    assert lift(src, "    function syncGrid() {") =~ "if (gridCanvasPitch === null) {"
    [g] = run("[[0, 0, 1]]", home: 0.25)
    assert g["pitch"] == 96.0
  end

  test "not painted before the picture is in, when home is not known yet" do
    [g] = run("[[0, 0, 1]]", ready: false)
    assert g["pitch"] == nil
    refute g["tagged"]
  end

  test "the dots sit on fixed canvas points, so a pan carries them exactly" do
    [a, b] = run("[[10, 20, 0.7], [110, -30, 0.7]]")
    assert a["pitch"] == b["pitch"]
    assert_in_delta mod(b["x"] - a["x"], a["pitch"]), mod(100.0, a["pitch"]), 0.02
    assert_in_delta mod(b["y"] - a["y"], a["pitch"]), mod(-50.0, a["pitch"]), 0.02
  end

  test "a dot lies on the canvas origin's lattice, whatever the pan and zoom" do
    for [tx, ty, s] <- [[0, 0, 1], [37.5, -12.25, 0.3], [-900, 410, 3.7]] do
      [g] = run(Jason.encode!([[tx, ty, s]]))

      assert_in_delta mod(g["x"] + g["pitch"] / 2 - tx, g["pitch"]) |> min_wrap(g["pitch"]),
                      0,
                      0.02

      assert_in_delta mod(g["y"] + g["pitch"] / 2 - ty, g["pitch"]) |> min_wrap(g["pitch"]),
                      0,
                      0.02
    end
  end

  test "zoomed out so far the dots would smear, the whole grid fades together" do
    # Pitch 8 px at s = 1/6 (home 0.5), 4 px at 1/12.
    [edge, half, gone] = run("[[0, 0, #{1 / 6}], [0, 0, #{1 / 8}], [0, 0, #{1 / 12}]]")
    assert edge["alpha"] == 100
    assert half["alpha"] == 50
    assert gone["alpha"] == 0
  end

  test "dots grow as you zoom in and shrink as you zoom out, about a pixel at home" do
    [home, near, far, way_in, way_out] =
      run("[[0,0,0.5],[0,0,1],[0,0,0.25],[0,0,500],[0,0,0.0001]]")

    assert home["r"] == 1.0
    assert near["r"] > 1.0 and near["r"] < 2.0, "more gently than the spacing"
    assert far["r"] < 1.0
    assert way_in["r"] == 3.0, "never enough to blot"
    assert way_out["r"] == 0.5, "never vanishing"
  end

  test "a hidden grid is left alone" do
    [g] = run("[[0, 0, 1]]", visible: false)
    assert g["pitch"] == nil
    refute g["tagged"]
  end

  test "every frame resyncs it, and so does turning it back on" do
    src = File.read!(@source)
    apply_fn = lift(src, "    function apply() {")
    assert apply_fn =~ "syncGrid();", "apply() paints the grid with the picture"
    assert lift(src, "    function setGridVisible(on) {") =~ "syncGrid();"
    # And the stylesheet reads what syncGrid writes — off the variables
    # alone, never an attribute a LiveView patch would strip (a saved
    # drawing used to snap the grid back to the static one until a pan).
    refute src =~ ~s(.fresco-viewer[data-fresco-grid] {)
    assert src =~ ~S|background-size: var(--fresco-grid-pitch, 24px) var(--fresco-grid-pitch, 24px);|
    assert src =~ ~s(.fresco-viewer.fresco--no-grid { background-image: none; })
  end

  test "a host rewriting the viewer's attributes gets the grid put straight back" do
    src = File.read!(@source)
    assert src =~ ~S|gridGuard.observe(el, { attributes: true, attributeFilter: ["style", "class"] });|
    assert src =~ ~r/!el\.style\.getPropertyValue\("--fresco-grid-pitch"\)\) \{\s*gridKey = "";\s*syncGrid\(\);/
    assert src =~ "if (gridGuard) { gridGuard.disconnect(); gridGuard = null; }"
  end

  defp mod(a, n), do: a - n * Float.floor(a / n)
  defp min_wrap(v, n), do: min(v, n - v)
end
