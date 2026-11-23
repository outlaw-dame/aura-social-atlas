# Proposal for Bonfire: Mastodon's domain blocks API

**Status:** draft for Bonfire's maintainers, not sent. Written 23 Nov 2026 against `bonfire_api_graphql`, `bonfire_boundaries` and `bonfire_me` `main`, and the commits Fedizen's v1.1.0-rc.1 pins. The Elixir below has not been compiled or run.

## Why

Mastodon lets a person block a whole server for themselves ("Block domain" in a profile's menu). The API has three endpoints since Mastodon 1.4 ([docs](https://docs.joinmastodon.org/methods/domain_blocks/)):

| Method | Path | Parameters | Scope |
|---|---|---|---|
| GET | `/api/v1/domain_blocks` | `limit` (default 100, max 200), paging by `Link` header | `read:blocks` or `follow` |
| POST | `/api/v1/domain_blocks` | `domain` | `write:blocks` or `follow` |
| DELETE | `/api/v1/domain_blocks` | `domain` | `write:blocks` or `follow` |

Relationships also carry `domain_blocking`.

Bonfire already supports this for a person: `Bonfire.Boundaries.Blocks.block/3` takes "users or instances". A `Bonfire.Data.ActivityPub.Peer` is blocked through its instance circle (`do_mutate_blocklists/3`, "for blocking of instances, we use the instance's Circle instead of the Peer"). Bonfire's own pages use this under Settings → Blocked. What's missing is the API:

- `masto_compatible_router.ex` has `/blocks` and `/mutes` but no `/domain_blocks`.
- `Mastodon.Schemas.Relationship` always answers `"domain_blocking" => false`.
- GraphQL's `blocked_users` lists people only.

So Mastodon apps (Ivory, Phanpy, Tusky, Ice Cubes, Atlas…) can't offer or show server blocks.

Today, Atlas can only reach this indirectly: `blockUser(id: <peerId>)`, with the id from `user { character { peered { peerId } } }`. That blocks the server, but then the resolver loads the id as a user and returns an error, so apps can't tell success from failure. Apps also can't list or unblock reliably.

## Proposed change

### Router (`bonfire_api_graphql/lib/web/masto_compatible_router.ex`, authenticated scope)

```elixir
# Domain blocks (Mastodon 1.4): a person's own server blocks
get "/domain_blocks", Bonfire.Me.Web.MastoAccountController, :domain_blocks
post "/domain_blocks", Bonfire.Me.Web.MastoAccountController, :block_domain
delete "/domain_blocks", Bonfire.Me.Web.MastoAccountController, :unblock_domain
```

### Controller (`bonfire_me` `MastoAccountController`, beside `mutes/2` and `blocks/2`)

```elixir
def domain_blocks(conn, params), do: BoundariesAdapter.domain_blocks(params, conn)
def block_domain(conn, params), do: BoundariesAdapter.block_domain(params, conn)
def unblock_domain(conn, params), do: BoundariesAdapter.unblock_domain(params, conn)
```

### Adapter (`bonfire_boundaries/lib/api/graphql_masto_adapter.ex`)

```elixir
@doc "Mastodon's GET /api/v1/domain_blocks: hostnames of the servers the current user has blocked (ghosted and silenced)"
def domain_blocks(params, conn) do
  with {:ok, user} <- current_user_or_unauthorized(conn) do
    limit = params |> Map.get("limit", "100") |> to_integer(100) |> min(200) |> max(1)

    hosts =
      Blocks.user_block_circles(user, :ghost)
      |> instance_hostnames()
      |> MapSet.new()
      |> MapSet.intersection(MapSet.new(instance_hostnames(Blocks.user_block_circles(user, :silence))))
      |> Enum.sort()

    # Mastodon pages by the block's id; hostnames sorted and cut at `limit` is enough for a first version
    RestAdapter.json(conn, Enum.take(hosts, limit))
  end
end

@doc "Mastodon's POST /api/v1/domain_blocks (domain=…): block a whole server for the current user"
def block_domain(%{"domain" => domain}, conn), do: change_domain_block(conn, domain, :block)
def block_domain(_, conn), do: RestAdapter.error_fn({:error, :bad_request}, conn)

@doc "Mastodon's DELETE /api/v1/domain_blocks (domain=…)"
def unblock_domain(%{"domain" => domain}, conn), do: change_domain_block(conn, domain, :unblock)
def unblock_domain(_, conn), do: RestAdapter.error_fn({:error, :bad_request}, conn)

defp change_domain_block(conn, domain, action) do
  with {:ok, user} <- current_user_or_unauthorized(conn),
       host when is_binary(host) <- normalize_host(domain),
       false <- host == Bonfire.Common.URIs.base_domain() || {:error, :unprocessable_entity},
       {:ok, peer} <- Bonfire.Federate.ActivityPub.Instances.get_or_create(host),
       {:ok, _} <- do_change(action, peer, user) do
    # Mastodon answers an empty object
    RestAdapter.json(conn, %{})
  else
    e -> RestAdapter.error_fn(e, conn)
  end
end

defp do_change(:block, peer, user), do: Blocks.block(peer, :block, current_user: user)

defp do_change(:unblock, peer, user) do
  with {:ok, _} <- Blocks.unblock(peer, :ghost, current_user: user),
       {:ok, _} <- Blocks.unblock(peer, :silence, current_user: user),
       do: {:ok, :unblocked}
end

# "example.social", also accepting "https://example.social/" and upper case, as Mastodon does
defp normalize_host(domain) do
  domain |> String.trim() |> String.downcase() |> then(&(URI.parse(if &1 =~ "://", do: &1, else: "https://" <> &1).host))
end

# The instance circles (stereotype Bonfire.Boundaries.Scaffold.Instance.activity_pub_circle/0) among a block
# circle's members, by their name (the server's display_hostname)
defp instance_hostnames(block_circles) do
  block_circles
  |> List.wrap()
  |> repo().maybe_preload(encircles: [subject: [:named, :stereotyped]])
  |> Enum.flat_map(&e(&1, :encircles, []))
  |> Enum.map(&e(&1, :subject, nil))
  |> Enum.filter(&instance_circle?/1)
  |> Enum.map(&e(&1, :named, :name, nil))
  |> Enum.reject(&is_nil/1)
end
```

`instance_circle?/1` should match the stereotype `Bonfire.Boundaries.Scaffold.Instance.activity_pub_circle()` that `Circles.get_or_create(display_hostname, …)` gives instance circles. Use whatever `Blocks` already uses to tell them apart, rather than a new rule.

### Relationship (`bonfire_api_graphql/lib/mastodon_compat/schemas/relationship.ex` and its builder)

Fill `domain_blocking` with `Blocks.is_blocked?(peer_of(account), :any, current_user: user)` instead of `false`, so apps can show "Unblock domain".

### Tests

- POST then GET lists the host; DELETE removes it; blocking twice is idempotent.
- Posts and notifications from that host leave the user's feeds (both `:ghost` and `:silence`, as `block_user` does).
- Blocking your own instance's host is refused (422).
- `domain_blocking` is true for an account on that host and false elsewhere.
- Nothing is instance-wide: another user on the same instance is unaffected.

## What Atlas does once it ships

Atlas (`changeFedizenServerBlock`) moves from the GraphQL workaround to these endpoints:

- Fedizen's REST allowlist adds `/api/v1/domain_blocks` with its schema.
- Profiles show "Block <server>" or "Unblock <server>" from `domain_blocking`.
- Settings → Moderation lists blocked servers in Atlas instead of linking to Fedizen.
- The importer carries out Mastodon's `blocked_domains.csv` itself.
