defmodule Fresco.SwipeTest do
  @moduledoc """
  A one-finger swipe across a fully zoomed-out picture is the host's cue to
  show the next or previous one: `swipe` on the bus and a bubbling
  `fresco:swipe` DOM event, `%{direction: "left" | "right"}`.

  Only at the fitted view. Zoomed in, the same drag is a pan, and turning it
  into "next picture" would throw away the place the user was looking at.
  And only for a deliberate flick: far enough, mostly sideways, one finger,
  touch or pen. A mouse drag, a pinch, a stroke an overlay is drawing, or a
  cancelled touch never changes the picture.

  Runs the real pointer handlers, through Fresco.Test.PointerHarness.
  """
  use ExUnit.Case, async: true

  alias Fresco.Test.PointerHarness, as: H

  # sFit equal to the scale: the picture is at its fitted view.
  @at_fit [claimed: false, s_fit: 1]

  defp swipes(out) do
    for %{"event" => "swipe", "detail" => %{"direction" => d}} <- out["log"], do: d
  end

  defp dom(out) do
    for %{"dom" => "fresco:swipe", "detail" => %{"direction" => d}} <- out["log"], do: d
  end

  test "a flick to the left at the fitted view asks for the next picture" do
    out = H.press([H.down(1, 300, 200), H.move(1, 200, 205), H.up_at(1, 180, 210)], @at_fit)

    assert swipes(out) == ["left"]
    assert dom(out) == ["left"], "and says so on the element, for a host listening above it"
  end

  test "to the right, the previous one" do
    out = H.press([H.down(1, 100, 200), H.up_at(1, 220, 190)], @at_fit)
    assert swipes(out) == ["right"]
  end

  test "zoomed in, the drag is a pan and nothing else" do
    out = H.press([H.down(1, 300, 200), H.up_at(1, 150, 200)], claimed: false, s_fit: 0.5)
    assert swipes(out) == []
  end

  test "a short nudge is not a swipe" do
    out = H.press([H.down(1, 300, 200), H.up_at(1, 270, 200)], @at_fit)
    assert swipes(out) == []
  end

  test "a mostly vertical drag is not a swipe" do
    out = H.press([H.down(1, 300, 200), H.up_at(1, 240, 320)], @at_fit)
    assert swipes(out) == []
  end

  test "a mouse drag is never read as next" do
    out = H.press([H.down(1, 300, 200, type: "mouse"), H.up_at(1, 100, 200)], @at_fit)
    assert swipes(out) == []
  end

  test "two fingers are a pinch, not a swipe — even after one lifts" do
    out =
      H.press(
        [H.down(1, 300, 200), H.down(2, 400, 200), H.up_at(2, 400, 200), H.up_at(1, 100, 200)],
        @at_fit
      )

    assert swipes(out) == []
  end

  test "a finger an overlay claimed (a pen stroke) is not a swipe" do
    out = H.press([H.down(1, 300, 200), H.up_at(1, 100, 200)], claimed: true, s_fit: 1)
    assert swipes(out) == []
  end

  test "a cancelled touch changes nothing" do
    out = H.press([H.down(1, 300, 200), H.up_at(1, 100, 200, type: "pointercancel")], @at_fit)
    assert swipes(out) == []
  end
end
