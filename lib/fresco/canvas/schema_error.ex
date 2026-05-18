defmodule Fresco.Canvas.SchemaError do
  @moduledoc """
  Raised (or returned) when a `.fresco` JSON payload doesn't conform to
  the schema.

  `:path` points at the offending field (a list of atoms / indices like
  `[:images, 2, :width]`). `:reason` is a structured term explaining what
  failed (e.g. `{:expected_positive_number, -3}`, `{:duplicate_id, "img-1"}`,
  `:missing`). Callers can pattern-match on `:reason` to surface useful
  user-facing messages.
  """

  defexception [:path, :reason]

  @impl true
  def exception(opts) do
    %__MODULE__{
      path: Keyword.get(opts, :path, []),
      reason: Keyword.get(opts, :reason)
    }
  end

  @impl true
  def message(%__MODULE__{path: path, reason: reason}) do
    "Fresco.Canvas schema error at #{inspect(path)}: #{inspect(reason)}"
  end
end
