# Co-op Cloud / Abra: optional Bonfire relay-client integration

Status: **operator procedure only; no deployment or relay connection performed**.
Fedizen's provider confirms Bonfire **Community**, Co-op Cloud (Abra), reported
version **`1.1.0-beta25`**. This identifies a deployment family, not an image,
source revision, or dependency set. Atlas is only a Fedizen client; neither
Atlas nor the separate `relay/` server can install this extension on Fedizen.

## 1. Verified upstream evidence (2026-11-06 UTC)

| Evidence | Verified result | What it does not establish |
|---|---|---|
| [App release](https://github.com/bonfire-networks/bonfire-app/releases/tag/v1.1.0-beta.25), [tag API](https://api.github.com/repos/bonfire-networks/bonfire-app/releases/tags/v1.1.0-beta.25) | Actual spelling **`v1.1.0-beta.25`**, tag commit `1eb308a9ec6f6049c6826edde59a3a092e668f32` | Fedizen's source or deployed image |
| [`mix.exs` at that commit](https://github.com/bonfire-networks/bonfire-app/blob/1eb308a9ec6f6049c6826edde59a3a092e668f32/mix.exs#L393-L399) | Config declares `version: "1.1.0-beta.25"`; project version uses `Mixer.version(config())` | Exact display formatting or compiled flavour/dependencies |
| [Recipe compose at `a0077148036faa7d189a36c18fc3ea868bc1c81c`](https://git.coopcloud.tech/coop-cloud/bonfire/src/commit/a0077148036faa7d189a36c18fc3ea868bc1c81c/compose.yml) | `image: ${CONTAINER_REGISTRY:-bonfirenetworks/bonfire}:${APP_VERSION:-1.0.7}-${APP_FLAVOUR:-social}-${APP_PLATFORM:-amd64}` | Host recipe revision or configured overrides |
| [Recipe environment sample](https://git.coopcloud.tech/coop-cloud/bonfire/src/commit/a0077148036faa7d189a36c18fc3ea868bc1c81c/.env.sample) | Optional `APP_VERSION` / `APP_FLAVOUR` selection | Compilation of a custom extension |
| [Upstream build workflow](https://github.com/bonfire-networks/bonfire-app/blob/1eb308a9ec6f6049c6826edde59a3a092e668f32/.github/workflows/_docker_build.yaml#L94-L127) | Build-time `FLAVOUR`, flavour preparation, `Dockerfile.release` | Reproducibility/provenance of the host's existing image |

The recipe's hard-coded deployment label `2.0.3+1.0.7-social-amd64` is recipe
metadata and can differ from the app selected through overrides. Do not read
it as the running Bonfire version. `APP_FLAVOUR=community` selects a
**precompiled** Community image; build-time `FLAVOUR=community` controls the
source build. An environment change cannot add an extension to an existing
release binary.

Public registry GET inspection found tag
`bonfirenetworks/bonfire:1.1.0-beta.25-community-amd64` at the
[Docker Hub tag API](https://hub.docker.com/v2/repositories/bonfirenetworks/bonfire/tags/1.1.0-beta.25-community-amd64):

- Reported top-level digest: `sha256:ff9997c4e3b3ab4ad9286fd069028def1e5675a41e57ed42930d02f44ea14a1f`.
- Listed Linux/amd64 image digest: `sha256:5e6dc44e491821c9c9e2877707eb5ffa91d21be66b401223b9882599578e8ea5`.

These are **registry metadata observations, not recommended deployment pins**
and not Fedizen's digest. Resolve index versus platform manifest explicitly;
release archive SHA-256 checksums are not OCI image digests. Never infer a
source match merely because a tag exists. No literal `beta25` tag is assumed.

## 2. Provider-facing request (copy/paste)

> We want to evaluate an optional Bonfire-native relay-client extension on
> staging first, not change live Fedizen or subscribe it to any relay yet.
> You confirmed Community on Co-op Cloud / Abra, displaying 1.1.0-beta25.
> Please provide only these nonsecret deployment facts:
>
> - Installed Abra version, Co-op Cloud Bonfire recipe release and exact
>   recipe commit, including any local/custom recipe modifications.
> - Application-reported version, `APP_VERSION`, `APP_FLAVOUR`,
>   `APP_PLATFORM`, and actual node OS/CPU architecture.
> - Application service name, image repository, complete resolved
>   `repository@sha256:...` reference, and index/platform digests if different.
> - If available: OCI source/revision/version labels, build attestation or
>   SBOM, app commit, Community flavour commit, dependency lockfile revisions
>   (especially activity_pub, bonfire_federate_activitypub, bonfire_ui_me).
>   Mark unavailable provenance explicitly rather than guessing from the tag.
> - Whether you support a custom immutable Community image and versioned
>   recipe image override, staging with a separate domain/database/volumes,
>   approved outbound networking, backups and maintenance-window migrations.
> - Confirmation that production DOMAIN, service actor ID/signing identity,
>   existing storage, and rollback image can be preserved.
>
> Please do not send passwords, tokens, private/signing keys, raw .env files,
> database connection strings, secret names/values, full Docker inspection
> output, registry credentials or user data. Keep sensitive infrastructure
> details in your normal private operator channel. This request is not
> permission to deploy or follow a relay.

## 3. Narrow, read-only inspection commands

Run on the provider's existing management host using their already-authorized
Docker context. Placeholders below are nonsecret identifiers, not credentials.
Do not switch Docker contexts or export credentials just to run these.

```sh
abra --version
abra app ls --help
abra app ps --help
abra app ls
abra app ls -s SERVER -S
abra app ps APP_DOMAIN
```

Verified against [Abra list source](https://git.coopcloud.tech/coop-cloud/abra/src/commit/550c9aa48fcdb587e03d43cceb261018095ff6ed/cli/app/list.go)
and [ps source](https://git.coopcloud.tech/coop-cloud/abra/src/commit/550c9aa48fcdb587e03d43cceb261018095ff6ed/cli/app/ps.go).
Check installed CLI help because versions differ. These do not redeploy or
subscribe; `Recipe.Ensure` may populate the local recipe cache. For strictly
zero local-cache writes use the Docker inspection below instead. Listing can
identify unrelated apps; share only the relevant row. Abra `app ps` strips
the SHA from its image display, so it is **not digest evidence**.

```sh
# Only names/images; use the relevant application service, not the DB service.
docker service ls --format '{{.Name}}\t{{.Image}}'
docker service inspect APP_SERVICE \
  --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
docker service inspect APP_SERVICE \
  --format '{{index .Spec.Labels "coop-cloud.STACK_NAME.version"}}'
docker service ps APP_SERVICE --no-trunc \
  --format '{{.Name}}\t{{.Image}}\t{{.CurrentState}}'

# On a node with the actual app image present; outputs selected OCI fields only.
docker image inspect IMAGE_REFERENCE --format '{{json .RepoDigests}}'
docker image inspect IMAGE_REFERENCE --format '{{.Os}}/{{.Architecture}}'
docker image inspect IMAGE_REFERENCE \
  --format '{{index .Config.Labels "org.opencontainers.image.source"}}'
docker image inspect IMAGE_REFERENCE \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
docker image inspect IMAGE_REFERENCE \
  --format '{{index .Config.Labels "org.opencontainers.image.version"}}'
```

Replace `STACK_NAME` **inside the label key** with the existing stack name.
Blank OCI fields mean provenance is unavailable. Inspecting a local image
does not pull it. If it is not cached, report that and have the provider
inspect the registry through its normal tooling, without exposing auth.
Service spec and task images must agree; report any unresolved tag.

The operator may read the existing app config privately and report only
`APP_VERSION`, `APP_FLAVOUR`, `APP_PLATFORM` and image repository. No command
here dumps container environment, secrets, configs, process arguments, logs
or app configuration. Do not use `docker inspect` without a narrow format,
`abra app config`, `abra app secret`, `docker secret inspect`, or raw env dumps
as evidence collection. Do not request credentials. There are intentionally
no live deploy/update/run commands in this guide.

## 4. Match source before building

1. Record an operator-reviewed bill of materials: actual baseline app,
   Community flavour and extension commits, dependency revisions/lockfile,
   recipe revision/patches, platform and baseline image digest. Treat missing
   provenance as a blocker to an exact match. The public beta-25 commit is
   a **candidate** only until reconciled with the host.
2. In a separate build workspace, acquire the matched app and Community
   flavour at immutable revisions, using the release's flavour mechanism.
   The beta-25 workflow invokes `just _clone_flavour_apps`,
   `just _config_flavour community`, `just _flavour_install community --yes`,
   `just flavour_make_symlinks community`, then `just _rel-prepare`.
   These steps can fetch moving dependencies: pin and review every fetched
   source before accepting the build. Use the matched revision's commands,
   not unreviewed current-main tooling.
3. Vendor this extension at an exact revision under
   `extensions/bonfire_relay_client`, then add its path dependency in the
   **matched flavour's actual manifest**. Preserve Community features,
   host-provided Ecto/LiveView dependencies and original lockfile constraints.
   A path dependency needs files in the image build context, not on the host.
4. Rebase the three `upstream_patches/` diffs against those actual dependency
   revisions. The previously verified HEADs are not beta-25 compatibility
   evidence. Verify all five capabilities (verified signer, preminted Follow,
   signed extra-inbox publishing, origin fetch/safe ingest, service Announce),
   including the `.sface` instance-settings mount. Stop on any API mismatch.
   Never bypass the signer, verification or ingestion gates to make it build.
5. Copy both migrations into the host's migration directory, retaining
   unique timestamps and reviewing collisions. Keep them additive in
   production; do not drop existing tables or recreate the host database.
6. Include the README configuration in the host's appropriate config layer:
   `enabled: false`, `outbound_enabled: false`, the Ecto store and admin
   authorizer, plus the inbox hook. Use no live relay hosts initially.
   Confirm Bonfire sees the modules in the production release (conditional
   compilation against host libraries must not omit Ecto/LiveView modules).

## 5. CI and immutable custom image gate

- Run this extension's compile, format and all 86 tests including loopback
  PostgreSQL migration/constraint/race tests; see the README commands.
- Build/test the **full matched Bonfire Community app**, including its
  federation suite, patched Surface template, admin/non-admin LiveView
  events, production dependency compilation, assets and release startup.
  Parsing patches or standalone render tests is insufficient.
- Test signer lookup failure: relay jobs must not send an unsigned request.
  The upstream publisher fallback noted in `upstream_patches/README.md`
  still needs host-level verification/hardening before production acceptance.
- Build via the matched `Dockerfile.release` and `FLAVOUR=community`, with
  the release's other build arguments preserved (GraphQL/native/AI/image
  settings as applicable). A generic Dockerfile or runtime bind mount is
  not a substitute for a compiled Bonfire release.
- Pin base images, sources, build dependencies and CI actions; record the
  resulting source revisions, patch checksums, SBOM and provenance. Keep
  credentials only in CI's secured credential flow, never image layers.
- Push to the provider-approved repository with a unique release identifier,
  resolve the OCI digest and scan/sign the artifact under host policy.
  Deployment must reference `repository@sha256:...`, not `latest`, a mutable
  version tag, or an invented digest. Staging and production use the same
  tested artifact on the same target platform. If platforms differ, test
  each platform artifact and record manifest/index relationships.

### Required versioned recipe change for a full digest reference

The inspected recipe appends `:VERSION-FLAVOUR-PLATFORM` to
`CONTAINER_REGISTRY`. **Do not put a full digest into that variable**; it
would produce an invalid reference. Maintain a reviewed custom recipe
commit that permits a complete app-image override, e.g. replace only the
app service image field with:

```yaml
services:
  app:
    image: ${BONFIRE_IMAGE:?Set the approved immutable repository@sha256 reference}
```

This is a source edit example, **not a complete Compose override to apply**.
If the provider uses an override file, prove that its installed Abra version
actually includes it; never assume it does. Keep the remaining recipe
configs, secrets, networks, uploads volume, service name, hostname routing
and entrypoint unchanged. Record `APP_VERSION`, `APP_FLAVOUR=community`,
`APP_PLATFORM` as metadata even when `BONFIRE_IMAGE` is authoritative.
CI must reject `BONFIRE_IMAGE` without a valid approved SHA-256 digest and
assert the rendered app image matches it; inspect rendered configuration
privately because it can contain sensitive environment values. The provider
must test its recipe fork/deploy method on staging before using production.

## 6. Staging and canary acceptance

1. Create a **separate staging app**, domain, database, volumes and service
   identity through the host's normal Abra process. Never change production
   `DOMAIN`. Use synthetic data, or a scrubbed restore with production keys
   and queued federation jobs removed; do not clone production identity into
   a second federating instance. Block outbound federation during restore.
2. Back up staging, deploy the custom digest using the reviewed recipe, and
   verify the digest in service spec/tasks. Review the recipe entrypoint and
   app release migration behavior: it may run migrations at startup. Do not
   run a second migration concurrently. Verify both new migrations and
   schema with the host's release-supported migration runner.
3. With feature **off**, check normal login/feed/GraphQL behavior, restart,
   persistent storage and queue lifecycle. Visit instance Relays as admin;
   refuse non-admin access/events. Creation must leave connections idle and
   must send nothing. Neither migration, release startup nor UI mount may
   auto-follow.
4. Only with a **separate, explicit staging approval**, allow a controlled
   relay origin (the optional `relay/` service is itself not deployed here).
   Enable the staging feature; have the staging admin resolve/add one relay
   and explicitly enable that connection. Test Mastodon and LitePub against
   separate identities/origins, including reciprocal LitePub Follow and
   selective tag/instance actors. Never test using a real production relay
   or FediBuzz without explicit approval.
5. Verify signed Follow/Accept/Announce, original-author attribution,
   same-author LD proof or origin re-fetch, SSRF/redirect restrictions,
   public-only filtering, duplicate/concurrent deliveries, temporary
   fetch/ingest retry, queue limits, disable/Undo and restart. Verify there
   are **no user follows, profile relay bots or relay-as-booster entries**.
   Check that local rules are filters, not a promise of complete coverage.
6. Observe bounded queues, rates and errors with sanitized monitoring.
   Record results and disable staging connections afterwards. Stop on
   missing signer, privacy failure, unstable queues or identity mismatch.

Staging is the canary. Do not operate a second production identity on the
same domain, or concurrently run an old binary that cannot handle the new
hooks merely to create a rolling canary. The provider chooses a maintenance
or fully verified rollout compatible with its actual queue/migration model.

## 7. Production operator procedure (future approval required)

1. Obtain a signed-off staging report, full-host checks and deployment
   approval. Keep relay enablement/subscription as a **separate approval**.
2. Record current app digest, recipe/config revisions, service actor URI and
   safe public-key fingerprint, database/migration state, storage and queue
   state. Never export the private signing key into a report.
3. Take provider-controlled consistent database and uploads/storage backups,
   plus secure recovery of existing configuration/identity material. Verify
   a restore on isolated staging. Keep backup credentials off this project.
4. Preserve production `DOMAIN`, stack/service identity, actor IDs/keys,
   database, volume attachments, routing, secrets and existing auth settings.
   Do not generate a new service actor or rotate signing keys as part of
   installing the extension. Quiesce workers/federation if required by the
   host's migration procedure; ensure a single migration runner.
5. Deploy the **same tested immutable custom image** via the reviewed recipe
   in the agreed window, feature/outbound still **off**. Verify actual task
   digests, migrations, hooks/modules, admin UI, login/content regression
   checks and identity continuity. No live Follow should have been emitted.
6. Only after further instance-admin authorization, enable the feature and
   selected idle connections with explicit confirmation. Start inbound-only
   with one approved allowlisted relay and conservative volume/queue limits.
   Outbound is a separate opt-in; do not auto-follow at boot, via config
   seeding or through any user account.

## 8. Rollback without destructive migration reversal

- Retain the last known-good immutable image and recipe/config revision.
  If connections were explicitly enabled, disable them while the new UI and
  hook code still exist, process the signed Undo/control-plane jobs and
  drain/quiesce relay workers. Freeze federation if safe completion is not
  possible; restoring an old image does not unsubscribe the remote relay.
- Turn the extension/outbound/inbox hook off using the host-supported config
  method. Remove the hook reference when rolling back to a release without
  its module. Redeploy the recorded previous digest through the approved
  recipe; preserve DOMAIN, actor identity, DB and volumes.
- **Keep the additive relay tables and migrations.** Do not run migration
  down or delete subscription/claim state on production image rollback.
  Confirm the old image tolerates extra tables before the original rollout.
  Preserve rows for future reconciliation; never auto-resubscribe on return.
- Database restore is disaster recovery, not routine code rollback: it can
  lose new content and duplicate federation deliveries. Use only the
  provider's explicit recovery decision and reconciled queue/identity plan.

## 9. Verification and unresolved gates

Verified here: public pinned source/recipe/build-workflow GET evidence above;
standalone Elixir compilation, formatting and regression results recorded
in the README: **86/86 passed with seeds 0 and 314159**, including nine
PostgreSQL 16.15 cases (both migrations up/down/up), on Elixir 1.18.5 / OTP 27;
warnings-as-errors compilation and format check passed. Fixed test-only
actor-resolver state leakage; no extension production logic changed.
This guide introduces no deploy script or live connection.

Still required from the host: installed recipe/Abra details, actual image
digest/provenance and matched flavour/dependency revisions; rebase/compile
and test patches in that full Community release; confirm Surface integration,
production release migration runner, immutable recipe override, network and
queue safeguards, backup/restore and staging signed federation interop.
No host access, image build, Fedizen migration, or live S2S delivery was
verified here. Do not describe the extension as installed or production-ready
until those gates pass.