defmodule Bonfire.RelayClient.Repo.Migrations.CreateRelayClientTables do
  use Ecto.Migration

  def change do
    create table(:bonfire_relay_client_subscriptions, primary_key: false) do
      add(:relay_actor_id, :text, primary_key: true)
      add(:relay_inbox, :text, null: false)
      add(:relay_host, :text, null: false)
      add(:protocol, :text, null: false)
      add(:state, :text, null: false, default: "pending")
      add(:follow_id, :text, null: false)
      add(:reciprocal_follow_id, :text)
      add(:local_actor_id, :text)
      timestamps(type: :utc_datetime_usec)
    end

    create(
      constraint(:bonfire_relay_client_subscriptions, :protocol_valid,
        check: "protocol IN ('mastodon','litepub')"
      )
    )

    create(
      constraint(:bonfire_relay_client_subscriptions, :state_valid,
        check: "state IN ('pending','accepted','rejected','unsubscribing','removed','failed')"
      )
    )

    create(unique_index(:bonfire_relay_client_subscriptions, [:follow_id]))

    create table(:bonfire_relay_client_seen, primary_key: false) do
      add(:activity_id, :text, primary_key: true)
      add(:status, :text, null: false, default: "claimed")
      add(:claimed_until, :utc_datetime_usec)
      add(:seen_at, :utc_datetime_usec, null: false)
    end

    create(
      constraint(:bonfire_relay_client_seen, :status_valid, check: "status IN ('claimed','done')")
    )

    create(index(:bonfire_relay_client_seen, [:seen_at]))
  end
end
