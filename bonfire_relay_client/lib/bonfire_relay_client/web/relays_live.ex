if Code.ensure_loaded?(Phoenix.LiveComponent) do
  defmodule Bonfire.RelayClient.Web.RelaysLive do
    @moduledoc """
    Instance settings → Relays admin screen (stateful LiveComponent).

    Mounted inside `Bonfire.UI.Me.InstanceSettingsLive` as tab `relays`
    (see `upstream_patches/bonfire_ui_me-relays-tab.patch`), so it inherits
    Bonfire's admin-only settings route, session and CSRF-protected LiveView
    socket. Authorisation is still re-checked server-side on EVERY event by
    `Bonfire.RelayClient.Admin`. Destructive actions need a typed
    confirmation that is verified on the server, not just a browser dialog.

    Assigns: `id`, and `__context__` (Bonfire context; the current
    user/account is read from it). Tests may pass `relay_ctx` directly.
    """
    use Phoenix.LiveComponent
    alias Bonfire.RelayClient.{Admin, Context}

    @impl true
    def update(assigns, socket) do
      socket = assign(socket, Map.take(assigns, [:id, :__context__, :relay_ctx]))
      {:ok, socket |> assign_new(:flash_msg, fn -> nil end) |> load()}
    end

    defp ctx(socket) do
      case socket.assigns[:relay_ctx] do
        %{} = c -> {:ok, c}
        _ -> Context.build(socket.assigns[:__context__])
      end
    end

    defp load(socket) do
      with {:ok, c} <- ctx(socket),
           {:ok, o} <- Admin.overview(c) do
        assign(socket, overview: o, unavailable: nil)
      else
        {:error, reason} -> assign(socket, overview: nil, unavailable: reason)
      end
    end

    defp run(socket, fun, ok_msg) do
      msg =
        with {:ok, c} <- ctx(socket) do
          case fun.(c) do
            :ok -> ok_msg
            {:ok, _} -> ok_msg
            {:error, reason} -> "Error: " <> describe(reason)
            {:drop, reason} -> "Error: " <> describe(reason)
          end
        else
          {:error, r} -> "Error: " <> describe(r)
        end

      {:noreply, socket |> assign(flash_msg: msg) |> load()}
    end

    defp describe(r) when is_atom(r), do: r |> Atom.to_string() |> String.replace("_", " ")
    defp describe({a, _}) when is_atom(a), do: describe(a)
    defp describe(_), do: "unexpected error"

    @impl true
    def handle_event("add_connection", %{"conn" => p}, socket) do
      input =
        %{
          kind: p["kind"],
          url: blank(p["url"]),
          tag: blank(p["tag"]),
          domain: blank(p["domain"]),
          host: blank(p["host"]) || "relay.fedi.buzz",
          inbound_policy: if(p["inbound_policy"] == "rules_only", do: :rules_only, else: :all_public),
          outbound_enabled: p["outbound_enabled"] == "true",
          max_per_minute: int(p["max_per_minute"], 600)
        }
        |> Enum.reject(fn {_, v} -> is_nil(v) end)
        |> Map.new()

      run(socket, &Admin.add_connection(&1, input), "Connection added (disabled). Enable it to send the Follow.")
    end

    def handle_event("enable", %{"id" => id}, socket),
      do: run(socket, &Admin.enable(&1, id), "Follow queued; waiting for the relay to accept.")

    def handle_event("disable", %{"id" => id}, socket),
      do: run(socket, &Admin.disable(&1, id), "Disabled; Undo queued.")

    def handle_event("remove", %{"id" => id, "confirm" => confirm}, socket),
      do: run(socket, &Admin.remove(&1, id, confirm: confirm), "Connection removed.")

    def handle_event("add_tag_rule", %{"rule" => p}, socket) do
      attrs = %{tags: split(p["tags"]), mode: if(p["mode"] == "all", do: :all, else: :any)}
      run(socket, &Admin.add_tag_rule(&1, attrs), "Hashtag rule saved.")
    end

    def handle_event("add_domain_rule", %{"rule" => p}, socket) do
      attrs = %{
        domain: p["domain"],
        mode: if(p["mode"] == "whole_instance", do: :whole_instance, else: :observed),
        tags: split(p["tags"])
      }

      run(socket, &Admin.add_domain_rule(&1, attrs), "Instance rule saved.")
    end

    def handle_event("toggle_rule", %{"id" => id, "enabled" => e}, socket),
      do: run(socket, &Admin.set_rule_enabled(&1, id, e == "true"), "Rule updated.")

    def handle_event("delete_rule", %{"id" => id, "confirm" => confirm}, socket),
      do: run(socket, &Admin.delete_rule(&1, id, confirm: confirm), "Rule deleted.")

    def handle_event(_, _, socket), do: {:noreply, assign(socket, flash_msg: "Error: invalid request")}

    defp blank(nil), do: nil
    defp blank(s), do: if(String.trim(s) == "", do: nil, else: String.trim(s))

    defp int(nil, d), do: d

    defp int(s, d) do
      case Integer.parse(s) do
        {n, ""} -> n
        _ -> d
      end
    end

    defp split(nil), do: []
    defp split(s), do: s |> String.split([",", " ", "\n"], trim: true)

    @impl true
    def render(assigns) do
      ~H"""
      <section id={@id} class="relay-client-admin flex flex-col gap-6">
        <header>
          <h2 class="text-lg font-bold">Relays</h2>
          <p class="text-sm opacity-80">
            Relays deliver public posts to this instance. Subscriptions are sent by the instance's
            service actor. They never appear in anyone's following list, and relay accounts are
            never shown as boosting posts. Hashtag and instance rules only filter what connected
            relays actually deliver; they cannot discover posts no relay sends.
          </p>
        </header>

        <p :if={@flash_msg} role="status" class="alert">{@flash_msg}</p>

        <div :if={@unavailable} role="alert" class="alert alert-warning">
          Relay administration is unavailable ({describe(@unavailable)}).
        </div>

        <%= if @overview do %>
          <p :if={!@overview.feature_enabled} class="alert alert-info">
            The relay client is switched off in this instance's configuration. You can prepare
            connections and rules, but nothing is sent until an operator enables it.
          </p>

          <table class="table" aria-label="Relay connections">
            <thead>
              <tr><th>Relay</th><th>Type</th><th>Status</th><th>Inbound</th><th>Limit/min</th><th></th></tr>
            </thead>
            <tbody>
              <tr :for={c <- @overview.connections} id={"relay-" <> Base.url_encode64(c.relay_actor_id, padding: false)}>
                <td><code>{c.relay_actor_id}</code><span :if={c.topic}> ({c.topic})</span></td>
                <td>{c.kind || c.protocol}</td>
                <td>
                  <span class="badge">{c.state}</span>
                  <span :if={c.last_error} class="text-error text-xs"> {c.last_error}</span>
                </td>
                <td>{c.inbound_policy}</td>
                <td>{c.max_per_minute}</td>
                <td class="flex gap-2">
                  <button :if={c.state in [:idle, :failed, :rejected]} phx-click="enable" phx-value-id={c.relay_actor_id} phx-target={@myself} class="btn btn-sm">
                    {if c.state == :idle, do: "Enable", else: "Retry"}
                  </button>
                  <button :if={c.state in [:pending, :accepted]} phx-click="disable" phx-value-id={c.relay_actor_id} phx-target={@myself} data-confirm="Stop receiving from this relay?" class="btn btn-sm">
                    Disable
                  </button>
                  <form :if={c.state in [:idle, :failed, :rejected]} phx-submit="remove" phx-target={@myself} class="flex gap-1">
                    <input type="hidden" name="id" value={c.relay_actor_id} />
                    <input type="text" name="confirm" placeholder="Type the relay URL to delete" aria-label="Confirm relay URL" class="input input-sm" required />
                    <button type="submit" class="btn btn-sm btn-error">Delete</button>
                  </form>
                </td>
              </tr>
            </tbody>
          </table>

          <form phx-submit="add_connection" phx-target={@myself} class="flex flex-col gap-2" aria-label="Add relay">
            <h3 class="font-semibold">Add relay</h3>
            <select name="conn[kind]" aria-label="Relay type" class="select">
              <option value="mastodon">Mastodon relay (actor URL)</option>
              <option value="litepub">LitePub relay (actor URL)</option>
              <option value="fedibuzz_tag">FediBuzz hashtag relay</option>
              <option value="fedibuzz_instance">FediBuzz instance relay</option>
            </select>
            <input name="conn[url]" placeholder="https://relay.example/actor" aria-label="Relay actor URL" class="input" />
            <input name="conn[tag]" placeholder="FediBuzz hashtag, e.g. knitting" aria-label="Hashtag" class="input" />
            <input name="conn[domain]" placeholder="FediBuzz instance, e.g. fluffy.family" aria-label="Instance" class="input" />
            <input name="conn[host]" placeholder="relay.fedi.buzz" aria-label="FediBuzz host" class="input" />
            <select name="conn[inbound_policy]" aria-label="Inbound policy" class="select">
              <option value="all_public">Keep all public posts it delivers</option>
              <option value="rules_only">Keep only posts matching rules</option>
            </select>
            <input name="conn[max_per_minute]" type="number" min="1" max="100000" value="600" aria-label="Max posts per minute" class="input" />
            <button type="submit" class="btn btn-primary">Add (disabled)</button>
          </form>

          <h3 class="font-semibold">Rules</h3>
          <ul aria-label="Rules">
            <li :for={r <- @overview.rules} class="flex gap-2 items-center">
              <span>{rule_label(r)}</span>
              <span class="badge">{coverage_label(@overview.coverage[r.id])}</span>
              <button phx-click="toggle_rule" phx-value-id={r.id} phx-value-enabled={to_string(!r.enabled)} phx-target={@myself} class="btn btn-xs">
                {if r.enabled, do: "Pause", else: "Resume"}
              </button>
              <form phx-submit="delete_rule" phx-target={@myself} class="flex gap-1">
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="confirm" value={r.id} />
                <button type="submit" data-confirm="Delete this rule?" class="btn btn-xs btn-error">Delete</button>
              </form>
            </li>
          </ul>

          <form phx-submit="add_tag_rule" phx-target={@myself} class="flex gap-2" aria-label="Add hashtag rule">
            <input name="rule[tags]" placeholder="#knitting #crochet" aria-label="Hashtags" class="input" required />
            <select name="rule[mode]" aria-label="Match" class="select"><option value="any">any</option><option value="all">all</option></select>
            <button type="submit" class="btn">Add hashtag rule</button>
          </form>

          <form phx-submit="add_domain_rule" phx-target={@myself} class="flex gap-2" aria-label="Add instance rule">
            <input name="rule[domain]" placeholder="fluffy.family" aria-label="Instance domain" class="input" required />
            <select name="rule[mode]" aria-label="Scope" class="select">
              <option value="observed">Only posts relays deliver</option>
              <option value="whole_instance">Whole instance (needs a FediBuzz instance relay)</option>
            </select>
            <input name="rule[tags]" placeholder="optional #tags" aria-label="Optional hashtags" class="input" />
            <button type="submit" class="btn">Add instance rule</button>
          </form>
        <% end %>
      </section>
      """
    end

    defp rule_label(%Bonfire.RelayClient.Rules.TagRule{} = r),
      do: "#{r.mode} of " <> Enum.map_join(r.tags, " ", &("#" <> &1))

    defp rule_label(%Bonfire.RelayClient.Rules.DomainRule{} = r),
      do:
        "#{r.domain} (#{r.mode})" <>
          if(r.tags == [], do: "", else: " with " <> Enum.map_join(r.tags, " ", &("#" <> &1)))

    defp coverage_label({:active, srcs}), do: "active via #{length(srcs)} relay(s)"
    defp coverage_label({:no_source, _}), do: "no source: nothing delivers this yet"
    defp coverage_label({:disabled, _}), do: "paused"
    defp coverage_label(_), do: "unknown"
  end
end
