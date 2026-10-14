defmodule Fresco.KonamiTest do
  @moduledoc """
  ↑ ↑ ↓ ↓ ← → ← → B A ripples the dots. The key handler is read out of the
  bundle and run in node with `ripple` stubbed, so these check the sequence
  and its manners: the whole code fires it, a slip resets it, keys typed
  into a field never count, and once ↑ ↑ ↓ ↓ is in, the keys that follow
  are held back from the host (a gallery's ← / → would flip the picture).
  """
  use ExUnit.Case, async: true

  @source Path.expand("../../priv/static/fresco.js", __DIR__)

  defp lift(src, head) do
    start = :binary.match(src, head) |> elem(0)
    rest = binary_part(src, start, byte_size(src) - start)
    binary_part(rest, 0, :binary.match(rest, "\n    }") |> elem(0)) <> "\n    }"
  end

  # `keys` is a JS array of [key, targetTag]; returns ripples fired and,
  # per key, whether it was held back from the host.
  defp run(keys) do
    src = File.read!(@source)

    js = """
    var el = { isConnected: true, getBoundingClientRect: function() { return { width: 800, height: 600 }; } };
    var ripples = 0;
    function ripple() { ripples++; }
    #{Regex.run(~r/    var KONAMI = \[[^\]]+\];/s, src) |> hd()}
    #{Regex.run(~r/    var KONAMI_IDLE_MS = \d+;/, src) |> hd()}
    var konamiAt = 0, konamiLast = 0;
    #{lift(src, "    function onKonamiKey(e) {")}
    var held = #{keys}.map(function(k) {
      var stopped = false;
      onKonamiKey({ key: k[0], target: { tagName: k[1] || "DIV" },
        preventDefault: function() {}, stopImmediatePropagation: function() { stopped = true; } });
      return stopped;
    });
    console.log(JSON.stringify({ ripples: ripples, held: held }));
    """

    {out, 0} = System.cmd("node", ["-e", js])
    Jason.decode!(out)
  end

  @code ~s(["ArrowUp"],["ArrowUp"],["ArrowDown"],["ArrowDown"],["ArrowLeft"],["ArrowRight"],["ArrowLeft"],["ArrowRight"],["b"],["a"])

  test "the whole code ripples the dots" do
    assert %{"ripples" => 1} = run("[#{@code}]")
  end

  test "B and A count with Shift held" do
    code = String.replace(@code, ~s(["b"],["a"]), ~s(["B"],["A"]))
    assert %{"ripples" => 1} = run("[#{code}]")
  end

  test "a slip resets it, and an ↑ after the slip starts it again" do
    assert %{"ripples" => 0} = run(~s([["ArrowUp"],["ArrowUp"],["ArrowLeft"],["ArrowDown"],["ArrowDown"]]))
    assert %{"ripples" => 1} = run(~s([["ArrowUp"],["x"],#{@code}]))
  end

  test "keys typed into a field never count" do
    typed = String.replace(@code, "]", ~s(,"TEXTAREA"]))
    assert %{"ripples" => 0} = run("[#{typed}]")
  end

  test "past ↑ ↑ ↓ ↓ the keys are the code's, not the host's" do
    %{"held" => held} = run("[#{@code}]")
    assert held == [false, false, false, false, true, true, true, true, true, true]
  end

  test "it is wired on the window, ahead of the host, and unwired on teardown" do
    src = File.read!(@source)
    assert src =~ ~s|window.addEventListener("keydown", onKonamiKey, true);|
    assert src =~ ~s|window.removeEventListener("keydown", onKonamiKey, true);|
    assert src =~ "prefers-reduced-motion: reduce"
  end
end
