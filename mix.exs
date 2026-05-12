defmodule Fresco.MixProject do
  use Mix.Project

  @version "0.2.0"
  @description "Polished pan-zoom image viewer for Phoenix apps. The foundation for layered extensions (deep zoom, annotations, ML overlays); also useful standalone."
  @source_url "https://github.com/alexdont/fresco"

  def project do
    [
      app: :fresco,
      version: @version,
      description: @description,
      elixir: "~> 1.18",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      package: package(),
      docs: docs()
    ]
  end

  def application do
    [extra_applications: [:logger]]
  end

  defp deps do
    [
      {:phoenix_live_view, "~> 1.1"},
      {:phoenix_html, "~> 4.0"},
      {:jason, "~> 1.4"},
      {:ex_doc, "~> 0.39", only: :dev, runtime: false}
    ]
  end

  defp package do
    [
      name: "fresco",
      maintainers: ["Alexander Don"],
      licenses: ["MIT"],
      links: %{"GitHub" => @source_url},
      files: ~w(lib priv mix.exs README.md LICENSE CHANGELOG.md)
    ]
  end

  defp docs do
    [
      name: "Fresco",
      source_ref: "v#{@version}",
      source_url: @source_url,
      main: "Fresco",
      extras: ["README.md"]
    ]
  end
end
