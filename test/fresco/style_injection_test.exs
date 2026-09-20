defmodule Fresco.StyleInjectionTest do
  @moduledoc """
  Pins that the stylesheet lands when the BUNDLE loads, not when a hook mounts.

  `.fresco-viewer:not(.fresco--ready) .fresco-stage img { visibility: hidden }`
  is what keeps the server-rendered `<img>` off the screen until the engine
  has run its first fit. That markup carries CANVAS-pixel width/height and no
  stage transform, so while it is visible the picture is both magnified and —
  once a host's CSS reset clamps the width but not the height, as Tailwind
  preflight does — at the wrong aspect ratio.

  Injecting from `mounted()` meant the rule did not exist for the whole gap
  between the static render and the LiveView hook mounting. A page that loads
  with a viewer already on screen (deep link, refresh) painted the raw image
  for that entire gap — over a second on a cold load. The bundle parses far
  earlier than any hook mounts, so that is where the stylesheet belongs.

  This loads the real bundle into a stub DOM and mounts nothing.
  """
  use ExUnit.Case, async: true

  @source Path.expand("../../priv/static/fresco.js", __DIR__)

  # Evaluate the shipped bundle against a minimal DOM. Returns the CSS text of
  # every <style> appended to <head> by the time the script finishes parsing.
  defp styles_injected_at_load(opts \\ []) do
    head? = Keyword.get(opts, :head, true)

    js = """
    var appended = [];
    var deferred = [];
    function el() {
      return { style: {}, setAttribute: function() {}, appendChild: function() {},
               textContent: "", classList: { add: function() {}, remove: function() {} },
               addEventListener: function() {}, querySelectorAll: function() { return []; } };
    }
    var head = #{if head?, do: "{ appendChild: function(s) { appended.push(s.textContent); } }", else: "null"};
    global.window = { addEventListener: function() {}, location: { href: "" } };
    global.document = {
      head: head,
      createElement: function() { return el(); },
      addEventListener: function(name, fn) { deferred.push(name); },
      querySelectorAll: function() { return []; },
      querySelector: function() { return null; }
    };
    global.navigator = { userAgent: "node" };
    #{File.read!(@source)}
    console.log(JSON.stringify({ appended: appended, deferred: deferred }));
    """

    path =
      Path.join(
        System.tmp_dir!(),
        "fresco_style_injection_#{System.unique_integer([:positive])}.js"
      )

    File.write!(path, js)
    {out, 0} = System.cmd("node", [path], stderr_to_stdout: true)
    File.rm(path)

    json =
      out
      |> String.split("\n", trim: true)
      |> Enum.reverse()
      |> Enum.find(&String.starts_with?(&1, "{"))

    assert json, "the bundle did not run to completion under the stub DOM:\n#{out}"
    Jason.decode!(json)
  end

  test "the stylesheet is injected as the bundle loads, with no hook mounted" do
    %{"appended" => appended} = styles_injected_at_load()

    assert length(appended) == 1,
           "the bundle should inject its stylesheet exactly once at load — got #{length(appended)}"

    [css] = appended

    assert css =~
             ".fresco-viewer:not(.fresco--ready) .fresco-stage img:not([data-fresco-prefit]) {",
           """
           the pre-fit hiding rule is missing from the load-time stylesheet — \
           a viewer present at first paint will show the raw canvas-pixel image
           """

    assert css =~ ".fresco-stage {", "the stage rules should ship in the same sheet"
  end

  test "no <head> yet defers to DOMContentLoaded rather than dropping the sheet" do
    %{"appended" => appended, "deferred" => deferred} = styles_injected_at_load(head: false)

    assert appended == [], "nothing can be appended without a <head>"

    assert "DOMContentLoaded" in deferred,
           "with no <head> at parse time the injection must be retried on DOMContentLoaded"
  end
end
