defmodule Bonfire.RelayClient.Repo.Migrations.RelayClientAdminRules do
  @moduledoc "Additive: connection metadata, managed rules, volume ledger, idle state, fedibuzz protocol."
  use Ecto.Migration

  def up do
    alter table(:bonfire_relay_client_subscriptions) do
      add(:kind, :text)
      add(:topic, :text)
      add(:inbound_policy, :text, null: false, default: "all_public")
      add(:outbound_enabled, :boolean, null: false, default: false)
      add(:max_per_minute, :integer, null: false, default: 600)
      add(:created_by, :text)
      add(:last_error, :text)
      add(:error_count, :integer, null: false, default: 0)
    end

    # An idle (disabled) connection has no Follow in flight.
    execute("ALTER TABLE bonfire_relay_client_subscriptions ALTER COLUMN follow_id DROP NOT NULL")

    drop(constraint(:bonfire_relay_client_subscriptions, :protocol_valid))
    drop(constraint(:bonfire_relay_client_subscriptions, :state_valid))

    create(
      constraint(:bonfire_relay_client_subscriptions, :protocol_valid,
        check: "protocol IN ('mastodon','litepub','fedibuzz')"
      )
    )

    create(
      constraint(:bonfire_relay_client_subscriptions, :state_valid,
        check:
          "state IN ('idle','pending','accepted','rejected','unsubscribing','removed','failed')"
      )
    )

    create(
      constraint(:bonfire_relay_client_subscriptions, :kind_valid,
        check: "kind IS NULL OR kind IN ('mastodon','litepub','fedibuzz_tag','fedibuzz_instance')"
      )
    )

    create(
      constraint(:bonfire_relay_client_subscriptions, :policy_valid,
        check: "inbound_policy IN ('all_public','rules_only')"
      )
    )

    create(
      constraint(:bonfire_relay_client_subscriptions, :rate_valid,
        check: "max_per_minute BETWEEN 1 AND 100000"
      )
    )

    create table(:bonfire_relay_client_rules, primary_key: false) do
      add(:id, :text, primary_key: true)
      add(:rule_type, :text, null: false)
      add(:tags, {:array, :text}, null: false, default: [])
      add(:mode, :text, null: false, default: "any")
      add(:domain, :text)
      add(:domain_mode, :text)
      add(:scope_ids, {:array, :text})
      add(:enabled, :boolean, null: false, default: true)
      add(:created_by, :text)
      add(:note, :text)
      timestamps(type: :utc_datetime_usec)
    end

    create(
      constraint(:bonfire_relay_client_rules, :rule_shape,
        check:
          "(rule_type = 'tag' AND cardinality(tags) > 0 AND domain IS NULL) OR " <>
            "(rule_type = 'domain' AND domain IS NOT NULL AND domain_mode IN ('observed','whole_instance'))"
      )
    )

    create(index(:bonfire_relay_client_rules, [:domain]))
    create(index(:bonfire_relay_client_rules, [:tags], using: "GIN"))

    create table(:bonfire_relay_client_volume, primary_key: false) do
      add(:relay_actor_id, :text, null: false)
      add(:window_start, :bigint, null: false)
      add(:count, :integer, null: false, default: 0)
    end

    create(unique_index(:bonfire_relay_client_volume, [:relay_actor_id, :window_start]))
  end

  def down do
    drop(table(:bonfire_relay_client_volume))
    drop(table(:bonfire_relay_client_rules))
    drop(constraint(:bonfire_relay_client_subscriptions, :rate_valid))
    drop(constraint(:bonfire_relay_client_subscriptions, :policy_valid))
    drop(constraint(:bonfire_relay_client_subscriptions, :kind_valid))
    drop(constraint(:bonfire_relay_client_subscriptions, :state_valid))
    drop(constraint(:bonfire_relay_client_subscriptions, :protocol_valid))

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

    alter table(:bonfire_relay_client_subscriptions) do
      remove(:error_count)
      remove(:last_error)
      remove(:created_by)
      remove(:max_per_minute)
      remove(:outbound_enabled)
      remove(:inbound_policy)
      remove(:topic)
      remove(:kind)
    end
  end
end
