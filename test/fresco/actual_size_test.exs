defmodule Fresco.ActualSizeTest do
  @moduledoc """
  `actual_size` zooms in real pixels, the way a photo app does.

  100% is one natural pixel per PHYSICAL screen pixel, so on a 2× display
  it is half a CSS pixel. A picture opens at fit or 100%, whichever is
  smaller: a 4K photo on a laptop opens fitted and reads something like
  23%; a 50×50 icon opens at its real size, small and sharp, instead of
  blown up and blurred to fill the viewer. The magnifier-with-a-1 goes to
  100%, and from 100% to fit.

  Without `actual_size` nothing moves: home is the fitted view, as ever.

  The engine's own functions are read out of the bundle and run in node
  against the few variables they close over.
  """
  use ExUnit.Case, async: true

  @source Path.expand("../../priv/static/fresco.js", __DIR__)

  # Engine functions are indented four spaces. A one-line body ends on its
  # own line; the rest end at the next closing brace at that indent.
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

  defp run(script, opts) do
    src = File.read!(@source)

    heads = [
      "    function effectiveNaturalSize() {",
      "    function rotatedContentBBox() {",
      "    function sActual() {",
      "    function recomputeBounds() {",
      "    function clampPan() {",
      "    function refresh() {",
      "    function fit() {",
      "    function fitToView() {",
      "    function frameAt(scale) {",
      "    function zoomAt(px, py, k) {",
      "    function requestHome() {",
      "    function atScale(target) {",
      "    function zoomPercent() {",
      "    function zoomToActualSize() {",
      "    function toggleActualSize() {",
      "    function emitZoom() {",
      "    function formatPercent(p) {"
    ]

    {w, h} = Keyword.fetch!(opts, :image)

    js = """
    var window = { devicePixelRatio: #{Keyword.get(opts, :dpr, 1)} };
    var log = [];
    var bus = { _emit: function(n, d) { log.push({ event: n, detail: d }); } };
    var tx = 0, ty = 0, s = 1, rot = 0;
    var nw = 0, nh = 0, vw = 0, vh = 0;
    var sFit = 1, sMin = 1, sMax = 8, sHome = 1;
    var actualSize = #{Keyword.get(opts, :actual_size, true)};
    var infiniteCanvas = false;
    var customSMin = #{Keyword.get(opts, :floor, "null")}, customSMax = null;
    var customPanBounds = null, customHome = null;
    var el = { getBoundingClientRect: function() { return { width: 800, height: 600 }; } };
    function getNaturalSize() { return { w: #{w}, h: #{h} }; }
    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function requestFrame() {}
    function cancelAnimation() {}
    function rotationCosSin() { return { c: 1, sn: 0 }; }
    #{Enum.map_join(heads, "\n", &lift(src, &1))}
    var out = {};
    function pct() { return Math.round(zoomPercent() * 10) / 10; }
    fit();
    #{script}
    console.log(JSON.stringify(out));
    """

    {out, 0} = System.cmd("node", ["-e", js], stderr_to_stdout: true)
    Jason.decode!(String.trim(out))
  end

  describe "where a picture opens" do
    test "a 4K photo opens fitted, and says how far down that is" do
      out = run("out.pct = pct(); out.s = s;", image: {4000, 3000})
      assert out["s"] == 0.2
      assert out["pct"] == 20.0
    end

    test "on a 2× screen the same fit is twice the percentage — screen pixels, not CSS" do
      out = run("out.pct = pct();", image: {4000, 3000}, dpr: 2)
      assert out["pct"] == 40.0
    end

    test "a 50×50 icon opens at its real size, centred, not blown up to fill the view" do
      out = run("out.pct = pct(); out.s = s; out.tx = tx; out.ty = ty;", image: {50, 50}, dpr: 2)
      assert out["pct"] == 100.0
      assert out["s"] == 0.5, "25 CSS pixels: 50 screen pixels at 2×"
      assert out["tx"] == (800 - 25) / 2
      assert out["ty"] == (600 - 25) / 2
    end

    test "without actual_size, home is still the fitted view" do
      out = run("out.s = s;", image: {50, 50}, actual_size: false)
      assert out["s"] == 12
    end
  end

  describe "the zoom-out floor" do
    test "a small picture's real size is the floor, not the fit above it" do
      out = run("out.min = sMin;", image: {50, 50})
      assert out["min"] == 1
    end

    test "a host floor above home is lowered to it, so home stays reachable" do
      # Etcher sets a floor worked out from the fitted view.
      out = run("out.min = sMin;", image: {50, 50}, floor: 6)
      assert out["min"] == 1
    end

    test "without actual_size a host floor is left exactly as set" do
      out = run("out.min = sMin;", image: {50, 50}, floor: 6, actual_size: false)
      assert out["min"] == 6
    end
  end

  describe "the actual-size button" do
    test "a big photo: to 100%, and back home" do
      out =
        run(
          """
          toggleActualSize(); out.first = pct();
          toggleActualSize(); out.second = pct();
          """,
          image: {4000, 3000}
        )

      assert out["first"] == 100.0
      assert out["second"] == 20.0
    end

    test "a small picture is already at 100%: the button fills the view, then goes back" do
      out =
        run(
          """
          toggleActualSize(); out.first = s;
          toggleActualSize(); out.second = pct();
          """,
          image: {50, 50}
        )

      assert out["first"] == 12, "fitted: 600 / 50"
      assert out["second"] == 100.0
    end

    test "zoomed somewhere else, it goes to 100% first" do
      out = run("zoomAt(400, 300, 3); toggleActualSize(); out.pct = pct();", image: {4000, 3000})
      assert out["pct"] == 100.0
    end

    test "100% is about the middle of the view, so the centre stays put" do
      out =
        run(
          """
          var cx = (400 - tx) / s, cy = (300 - ty) / s;
          toggleActualSize();
          out.cx = (400 - tx) / s; out.cy = (300 - ty) / s; out.before = [cx, cy];
          """,
          image: {4000, 3000}
        )

      assert [out["cx"], out["cy"]] == out["before"]
    end

    test "every press reports the zoom with its percentage" do
      out =
        run(
          "toggleActualSize(); toggleActualSize(); out.zooms = log.map(function(e) { return Math.round(e.detail.percent); });",
          image: {4000, 3000}
        )

      assert out["zooms"] == [100, 20]
    end
  end

  test "both handles carry the zoom-in-real-pixels calls, not just the engine" do
    # The engine's methods reach a handle through a controller layer that
    # re-exports them by name; one missed there and `handle.x` is undefined.
    src = File.read!(@source)

    for name <- ~w(getZoomPercent zoomToActualSize toggleActualSize fitToView) do
      # engine + viewer controller + viewer handle + canvas controller + canvas handle
      assert length(Regex.scan(~r/^\s+#{name}:/m, src)) == 5, name
    end
  end

  test "the pill's numbers read like a photo app's" do
    out =
      run(
        "out.f = [233.4, 23.4, 10, 9.96, 4.5, 4.0, 0.25, 0.04].map(formatPercent);",
        image: {100, 100}
      )

    assert out["f"] == ["233%", "23%", "10%", "10%", "4.5%", "4%", "0.3%", "<0.1%"]
  end
end
