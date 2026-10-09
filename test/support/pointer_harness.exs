defmodule Fresco.Test.PointerHarness do
  @moduledoc """
  Runs Fresco's real pointer handlers (read out of the bundle) under node,
  against a rebuilt engine scope whose stubs record what each gesture did.
  Shared by the overlay-pinch and swipe tests.
  """

  @source Path.expand("../../priv/static/fresco.js", __DIR__)

  defp lift(src, head) do
    start = :binary.match(src, head) |> elem(0)
    rest = binary_part(src, start, byte_size(src) - start)
    binary_part(rest, 0, :binary.match(rest, "\n    }") |> elem(0)) <> "\n    }"
  end

  # The handlers close over the engine's scope, so the test rebuilds it: the
  # transform they move, and stubs that record what a gesture did instead of
  # painting anything.
  def press(events, opts \\ []) do
    src = File.read!(@source)

    consts =
      Regex.scan(~r/    var (DBL_ZOOMED|SWIPE_MIN_PX|SWIPE_RATIO|SWIPE_MAX_MS) = [\d.]+;/, src)
      |> Enum.map_join("\n", fn [line, _] -> line end)

    js = """
    (function() {
      var log = [];
      var MIDDLE_BUTTON = 1;
      var pointers = new Map();
      var gestureStart = null;
      var panButton = 0;
      var tx = 0, ty = 0, s = 1;
      var sMin = 0.05, sMax = 40;
      var sFit = #{Keyword.get(opts, :s_fit, 0.5)};
      var swipe = null;
      #{consts}
      var panLocked = #{Keyword.get(opts, :pan_locked, false)};
      var claimed = #{Keyword.get(opts, :claimed, true)};
      var blocksMiddle = #{Keyword.get(opts, :blocks_middle, true)};
      var suppressTapUntil = 0;
      var document = { querySelectorAll: function() { return []; } };
      var classes = [];
      var el = {
        setPointerCapture: function() {},
        dispatchEvent: function(ev) { log.push({ dom: ev.type, detail: ev.detail }); },
        releasePointerCapture: function() {},
        classList: {
          add: function(c) { if (classes.indexOf(c) === -1) classes.push(c); },
          remove: function(c) { var i = classes.indexOf(c); if (i !== -1) classes.splice(i, 1); }
        }
      };
      var bus = { _emit: function(name, detail) { log.push({ event: name, detail: detail }); } };
      function isFromNav() { return claimed; }
      function blocksMiddleDrag() { return blocksMiddle; }
      function cancelAnimation() {}
      function requestFrame() {}
      function clampPan() {}
      function viewportRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
      function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
      function gestureEnabled() { return true; }
      #{lift(src, "    function midpoint(p1, p2) {")}
      #{lift(src, "    function distance(p1, p2) {")}
      #{lift(src, "    function snapshotGesture() {")}
      #{lift(src, "    function onPointerDown(e) {")}
      #{lift(src, "    function onPointerMove(e) {")}
      #{lift(src, "    function endSwipe(e) {")}
      #{lift(src, "    function onPointerUp(e) {")}

      #{Enum.join(events, "\n      ")}

      console.log(JSON.stringify({
        log: log,
        classes: classes,
        counted: pointers.size,
        kind: gestureStart ? gestureStart.kind : null,
        tx: Math.round(tx * 100) / 100,
        ty: Math.round(ty * 100) / 100,
        s: Math.round(s * 1000) / 1000
      }));
    })();
    """

    {out, 0} = System.cmd("node", ["-e", js], stderr_to_stdout: true)
    Jason.decode!(String.trim(out))
  end

  def down(id, x, y, opts \\ []) do
    type = Keyword.get(opts, :type, "touch")
    button = Keyword.get(opts, :button, 0)

    "onPointerDown({ pointerId: #{id}, pointerType: \"#{type}\", button: #{button}, " <>
      "clientX: #{x}, clientY: #{y}, preventDefault: function() {} });"
  end

  def move(id, x, y, opts \\ []) do
    type = Keyword.get(opts, :type, "touch")

    "onPointerMove({ pointerId: #{id}, pointerType: \"#{type}\", " <>
      "clientX: #{x}, clientY: #{y} });"
  end

  def up(id) do
    "onPointerUp({ pointerId: #{id}, type: \"pointerup\", clientX: 0, clientY: 0 });"
  end

  def up_at(id, x, y, opts \\ []) do
    type = Keyword.get(opts, :type, "pointerup")
    "onPointerUp({ pointerId: #{id}, type: \"#{type}\", clientX: #{x}, clientY: #{y} });"
  end
end
