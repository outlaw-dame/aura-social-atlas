# Co-op Cloud / Abra: optional Bonfire relay-client integration

Status: **operator procedure only; no deployment or relay connection performed**.
Fedizen's provider confirms Bonfire **Community**, Co-op Cloud (Abra),
upgraded to reported baseline **`v1.1.0-rc.1`**. The former reported
`1.1.0-beta25` is **archival only**, not the current running image.
This identifies a deployment family, not an image,
source revision, or dependency set. Atlas is only a Fedizen client; neither
Atlas nor the separate `relay/` server can install this extension on Fedizen.

## 1. Verified upstream evidence (2026-11-06 UTC)

### Official recipe catalogue and revision-specific source audit

The [official recipe page](https://recipes.coopcloud.tech/bonfire) links to
the [canonical recipe repository](https://git.coopcloud.tech/coop-cloud/bonfire).
Rendered catalogue content was read via website-fetch on 2026-11-06: it
describes the recipe as **alpha**, lists versions through
`2.0.2+1.0.7-social-amd64`, and leaves Backups/Tests/Healthcheck metadata
blank. The page is not proof of the host's installed recipe, app version,
digest or tested RC compatibility. Blank backup metadata is not proof that
no backup implementation exists. Its mutable `latest-alpha` suggestion is
**not** accepted by this immutable-image procedure.

Canonical [tags API](https://git.coopcloud.tech/api/v1/repos/coop-cloud/bonfire/tags?limit=100)
and source history show two different image-variable families:

| Exact observed recipe revision | Application image expression | Meaning |
|---|---|---|
| Historical [`5f22200a764db9dd0f47cd1a69edd21dcaa1b7b5`](https://git.coopcloud.tech/coop-cloud/bonfire/src/commit/5f22200a764db9dd0f47cd1a69edd21dcaa1b7b5/compose.yml), and pre-release [`df3229884d144f48ca5541f25bd88d874a68c044`](https://git.coopcloud.tech/coop-cloud/bonfire/src/commit/df3229884d144f48ca5541f25bd88d874a68c044/compose.yml) | `image: ${APP_DOCKER_IMAGE}` | Complete image reference; no suffix added by Compose |
| Release preparation [`d74f05c0d150be6f78b69df743cba2ea14b7d00b`](https://git.coopcloud.tech/coop-cloud/bonfire/src/commit/d74f05c0d150be6f78b69df743cba2ea14b7d00b/compose.yml) | `${CONTAINER_REGISTRY:-bonfirenetworks/bonfire}:${APP_VERSION:-1.0.5}-${APP_FLAVOUR:-social}-${APP_PLATFORM:-amd64}` | Repository plus composed tag, not complete-image override |
| Published `1.0.0+1.0.5-social-amd64` (`79a43dbadc54e1d3abc24f379f39ac2e8d2f8ebc`) and `2.0.0+1.0.5-social-amd64` (`ead44b7103ec0665d3df83d9a489c7e9ad158b8d`) | Same composition, default app `1.0.5` | Published releases use newer family |
| Published `2.0.1+1.0.6-social-amd64` (`a49cdecfd89f8aed6426694b85644e3b2a46714b`) | Same composition, default app `1.0.6` | Not a complete `APP_DOCKER_IMAGE` input |
| Published [`2.0.2+1.0.7-social-amd64`](https://git.coopcloud.tech/coop-cloud/bonfire/src/commit/90f5ff3fbb0226d9394b9c017a7f0e96f3a6626a/compose.yml) (`90f5ff3fbb0226d9394b9c017a7f0e96f3a6626a`), observed main `a0077148036faa7d189a36c18fc3ea868bc1c81c` | Same composition, default app `1.0.7` | Neither is established as Fedizen's revision |

No published tag returned in this audit used `APP_DOCKER_IMAGE`; that design
was verified at historical commits. Do not infer the family from the Bonfire
RC version or a variable found in an old sample: inspect the host's actual
`compose.yml` and enabled overlays at its exact recipe commit.

Reviewed at observed main `a0077148036faa7d189a36c18fc3ea868bc1c81c`:

- [`.env.sample`](https://git.coopcloud.tech/coop-cloud/bonfire/src/commit/a0077148036faa7d189a36c18fc3ea868bc1c81c/.env.sample)
  documents `APP_FLAVOUR` (default social), `APP_VERSION`, and `APP_PLATFORM`
  (default amd64, sample alternative aarch64). `APP_PLATFORM` is a **tag
  component**, not Docker `platform:` enforcement; verify the actual RC tag
  and OCI platform (arm64 versus legacy aarch64 suffixes), never assume all
  combinations exist. Historical samples instead use `FLAVOUR` and construct
  their complete `APP_DOCKER_IMAGE` value. This does not change build-time
  `FLAVOUR=community` requirements for the compiled custom image.
- The sample explicitly warns **DO NOT CHANGE DOMAIN AFTER DEPLOYMENT**.
  Compose passes it as app `HOSTNAME` and Traefik routing. This is documented
  federation immutability, not an enforced recipe lock; aliases are not a
  migration of the canonical actor origin.
- [`entrypoint.sh.tmpl`](https://git.coopcloud.tech/coop-cloud/bonfire/src/commit/a0077148036faa7d189a36c18fc3ea868bc1c81c/entrypoint.sh.tmpl)
  optionally loads a Meilisearch secret and ends in `exec "$@"`; Compose
  invokes `./bin/bonfire start`. It neither rewrites the image tag nor itself
  runs migration commands. `DISABLE_DB_AUTOMIGRATION` is passed through to
  the release: actual startup/migration semantics must be checked in the
  matched app, not inferred from this shell wrapper.
- [`abra.sh`](https://git.coopcloud.tech/coop-cloud/bonfire/src/commit/a0077148036faa7d189a36c18fc3ea868bc1c81c/abra.sh)
  sets `APP_ENTRYPOINT_VERSION=v4` while Compose's fallback is `v3`; it sets
  `PG_BACKUP_VERSION=v6`. Record recipe/config versions and preserve existing
  Swarm configs rather than assuming fallback versions were deployed.
- [`README`](https://git.coopcloud.tech/coop-cloud/bonfire/src/commit/a0077148036faa7d189a36c18fc3ea868bc1c81c/README.md)
  warns custom app versions can be incompatible and are not recommended for
  production without verification. Optional static/nginx and database/search
  overlays depend on the active `COMPOSE_FILE`; inspect the complete set.
- App mounts `upload-data` at `/opt/app/data/uploads` and references existing
  secret-file inputs including secret key base, signing/encryption salts and
  release cookie. Preserve their existing references/versions, not their
  values in reports. These runtime salts are **not** substitutes for stored
  ActivityPub actor signing keys: preserve the database and service identity
  too. Never seed a replacement service actor during image installation.

### Backup support: configuration is not a verified recovery guarantee

The sample enables `ENABLE_BACKUPS=true`; app labels opt into backupbot.
The [PostgreSQL overlay](https://git.coopcloud.tech/coop-cloud/bonfire/src/commit/a0077148036faa7d189a36c18fc3ea868bc1c81c/compose.postgres.yml)
has DB backupbot pre-hook `/pg_backup.sh backup`, volume path `backup.sql`,
and restore post-hook `/pg_backup.sh restore`. The
[`pg_backup.sh`](https://git.coopcloud.tech/coop-cloud/bonfire/src/commit/a0077148036faa7d189a36c18fc3ea868bc1c81c/pg_backup.sh)
writes `pg_dump` to a temporary file and atomically replaces `backup.sql`.
Its restore path **drops/recreates the database** and temporarily alters local
DB authentication. Do not execute this for routine image rollback.

Request the provider's enabled DB overlay, backupbot version/schedule,
off-host retention, uploads-volume and any S3-object coverage, secure
identity/config recovery, and a successful isolated restore test. Labels,
`ENABLE_BACKUPS`, or a local dump do not establish those outcomes. The newer
DB overlay also composes `DB_DOCKER_IMAGE:DB_DOCKER_VERSION` (observed defaults
PostGIS `17-3.5`); installing this extension must **not silently upgrade the
database image/major version** while selecting a different recipe. Preserve
the provider's actual DB service, volumes and migration strategy.

### Current reported target: RC.1 (not a verified live image)

- Canonical [GitHub release](https://github.com/bonfire-networks/bonfire-app/releases/tag/v1.1.0-rc.1)
  and [release API](https://api.github.com/repos/bonfire-networks/bonfire-app/releases/tags/v1.1.0-rc.1)
  report `v1.1.0-rc.1`, published `2026-11-05T17:09:52Z`.
- [Tag ref API](https://api.github.com/repos/bonfire-networks/bonfire-app/git/ref/tags/v1.1.0-rc.1)
  returns **annotated tag object** `d3e774208432f89a74896fece39321b2a9d7cba6`;
  [tag object API](https://api.github.com/repos/bonfire-networks/bonfire-app/git/tags/d3e774208432f89a74896fece39321b2a9d7cba6)
  resolves it to **source commit** `7815b3394031e384f00415f44fac1596070c8157`.
  Do not conflate the tag-object SHA, release `target_commitish`, or archive
  directory name with the source commit.
- [`mix.exs` at the resolved commit](https://github.com/bonfire-networks/bonfire-app/blob/7815b3394031e384f00415f44fac1596070c8157/mix.exs#L411)
  declares `version: "1.1.0-rc.1"`; project version still uses `Mixer.version(config())`.
- The [RC build workflow](https://github.com/bonfire-networks/bonfire-app/blob/7815b3394031e384f00415f44fac1596070c8157/.github/workflows/_docker_build.yaml)
  prepares build-time `FLAVOUR` and builds `Dockerfile.release`; the image is
  compiled, not extended by runtime `APP_FLAVOUR` changes.
- [Public Docker Hub tag API](https://hub.docker.com/v2/repositories/bonfirenetworks/bonfire/tags/1.1.0-rc.1-community-amd64)
  verifies tag `bonfirenetworks/bonfire:1.1.0-rc.1-community-amd64`:
  top-level digest `sha256:29ba7c625f89809a93d14f24ce5f03351d43b42cf529a26e29533e4aad4d0704`;
  listed Linux/amd64 image digest
  `sha256:3e959f5574f95829d122be847ef755758d43071318a97fc722c10c9759777115`.
  These are registry metadata, **not Fedizen's live digest**, build provenance,
  a custom-extension image, or recommended deployment pins. Host platform is
  not established by observing an amd64 tag. Resolve OCI index/platform
  relationships with the provider before selecting an artifact.
- Additional anonymous registry manifest/config GETs verify the multi-platform
  tag [`1.1.0-rc.1-community`](https://hub.docker.com/v2/repositories/bonfirenetworks/bonfire/tags/1.1.0-rc.1-community):
  OCI index `sha256:c2c4bf0a6162d94453257f7353d20503527c97554b4dbaec4c9f77d920c46e24`,
  amd64 manifest as above, arm64 manifest
  `sha256:59ff149aa1b7f65d4b4bac63ce38259159d46098e5d38f8670e01e4f4ebbdeab`.
  Both platform configs declare OCI revision
  `7815b3394031e384f00415f44fac1596070c8157`. Publisher labels support the
  published source association, not independent reproducibility or proof of
  compiled dependency contents. The annotated GitHub tag is unsigned.

**Mandatory host evidence:** request the **live service image digest and
installed recipe revision** after the upgrade, plus app/flavour/dependency
provenance and platform. No running Fedizen image has been inspected here.

### RC-pinned source compatibility (not HEAD)

The resolved RC app [`mix.lock`](https://github.com/bonfire-networks/bonfire-app/blob/7815b3394031e384f00415f44fac1596070c8157/mix.lock)
pins the following sources. The Community flavour is pinned to
[`a58f2fbc65ba3bf468b319d7f1e9d9a892ffb8a3`](https://github.com/bonfire-networks/community/tree/a58f2fbc65ba3bf468b319d7f1e9d9a892ffb8a3);
its dependency manifest includes moving repository entries, so the app lock
is an audit baseline, not proof a published or host-custom build retained it.

| Existing patch | RC app lockfile revision | Result on exact source archive |
|---|---|---|
| `activity_pub-relay-hooks.patch` | [`2931ec3757bce29b8043d84290403007b5b81def`](https://github.com/bonfire-networks/activity_pub/tree/2931ec3757bce29b8043d84290403007b5b81def) | Dry-run and application pass with `--fuzz=0`; patched receiver and new hooks parse |
| `bonfire_federate_activitypub-receive-relayed.patch` | [`e5489e30c8e7869ea695736f7867eb3c3167f137`](https://github.com/bonfire-networks/bonfire_federate_activitypub/tree/e5489e30c8e7869ea695736f7867eb3c3167f137) | Dry-run and application pass with `--fuzz=0`; patched incoming module parses |
| `bonfire_ui_me-relays-tab.patch` | [`803be49d039d5cdc8d89ce4f985de1519120f67c`](https://github.com/bonfire-networks/bonfire_ui_me/tree/803be49d039d5cdc8d89ce4f985de1519120f67c) | Both `.ex` and `.sface` hunks apply with `--fuzz=0`; `.ex` parses, Surface compilation unverified |

Compared to the older HEAD checks, the AP and federating-extension revisions
are different; UI matches the previously recorded `803be49` revision.
No patch edits were needed for textual application. Source inspection finds
`Utils.service_actor/0`, `generate_object_id/0,1`,
`Fetcher.fetch_remote_object_from_id/1,2`, `Publisher.enqueue_one/3`,
`Actor.get_cached_or_fetch/1,2`, `Object.get_ap_id/1`, `Object.insert/2,3,4`,
and virtual `relayed_by` / `signed_by` fields. The receiver retains
HTTP-signer options and LD/integrity-proof branches; Incoming retains the
Object-based pipeline and relayed-local handling; instance settings retain
the tab handler/template context used by the patch.

This raises compatibility evidence from **HEAD-only** to **RC-lockfile
textual/API inspection**. It does **not** verify the hooks' runtime behavior,
full Community compilation, Surface mount, signer failure safety, ingestion
semantics or federation tests. Apply/review again against the host's actual
dependency revisions; preserve fail-closed gates until full host checks pass.

**Semantic blockers identified at these RC pins (not fixed by patch fit):**

- `APPublisher.publish_one/1` can exhaust actor lookups and fall back to an
  unsigned POST. Supplying actor identifiers is not an unconditional signer
  guarantee; host integration must fail closed for relay jobs on lookup failure.
- The ingest hook inserts with empty authentication options; it does not
  preserve fetch/LD proof metadata or `data_received`. Host integration needs
  authenticated-object and cached-object tests without inventing proof.
- Incoming consumes `relayed_by` through `mirrored_group(..., create: true)`
  and derives `publish_in`; it is **not proven inert provenance**. Verify or
  adapt that mapping before claiming no relay-bot/group/boost side effects.
- The UI patch adds a handler and body, not a sidebar navigation entry;
  Surface wrapper/context propagation needs full-host testing.

These are production integration blockers, not reasons to weaken existing
verification. No production-code or patch behavior was changed in this
release-targeting update.

### Archived previous beta-25 evidence (not the reported current baseline)

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

Archived beta registry GET inspection found tag
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
> You confirmed the upgrade to Community on Co-op Cloud / Abra, reporting
> v1.1.0-rc.1. The former beta25 is archival, not our current target.
> Please provide only these nonsecret deployment facts:
>
> - Installed Abra version, Co-op Cloud Bonfire recipe release and exact
>   recipe commit, including local modifications and active COMPOSE_FILE
>   overlays; report the app image expression and whether it consumes
>   APP_DOCKER_IMAGE, CONTAINER_REGISTRY, or a custom full-image override.
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
`APP_VERSION`, flavour selector (`APP_FLAVOUR` or historical `FLAVOUR`),
`APP_PLATFORM`, full-image variable/repository, and active overlay filenames.
No command
here dumps container environment, secrets, configs, process arguments, logs
or app configuration. Do not use `docker inspect` without a narrow format,
`abra app config`, `abra app secret`, `docker secret inspect`, or raw env dumps
as evidence collection. Do not request credentials. There are intentionally
no live deploy/update/run commands in this guide.

## 4. Match source before building

1. Record an operator-reviewed bill of materials: actual baseline app,
   Community flavour and extension commits, dependency revisions/lockfile,
   recipe revision/patches, platform and baseline image digest. Treat missing
   provenance as a blocker to an exact match. The public RC.1 source commit is
   a **candidate** only until reconciled with the host.
2. In a separate build workspace, acquire the matched app and Community
   flavour at immutable revisions, using the release's flavour mechanism.
   The RC.1 workflow invokes `just _clone_flavour_apps`,
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
   revisions. The RC-lockfile application checks above are not evidence of
   the live host's dependency set or a full build. Verify all five capabilities (verified signer, preminted Follow,
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

### Select immutable-image override by the host's actual recipe revision

**Host-specific method cannot be confirmed until its exact recipe commit,
local diff and active overlays are supplied.** Use the source-audited branch
below; a historical sample alone is insufficient.

1. **Complete-reference family** (`image: ${APP_DOCKER_IMAGE}`): replace its
   active app-image assignment with the approved complete
   `repository@sha256:<64-hex-digest>` using `APP_DOCKER_IMAGE`. No recipe
   suffix is added. Remove conflicting duplicate assignments privately;
   retain compiled Community identity and verified platform as metadata.
   This is source-derived support, not a live Abra deployment test.
2. **Composed-tag family** (`CONTAINER_REGISTRY:VERSION-FLAVOUR-PLATFORM`):
   `APP_DOCKER_IMAGE` is **unused** by the app image expression, and
   `CONTAINER_REGISTRY` is a repository prefix despite its name. A full
   digest there is followed by a literal colon/tag suffix and is invalid;
   empty values do not remove `:-` defaults. For an arbitrary complete custom
   image reference, use a reviewed versioned recipe change replacing only
   `services.app.image`, e.g.:

```yaml
services:
  app:
    image: ${BONFIRE_IMAGE:?Set the approved immutable repository@sha256 reference}
```

This is a source edit example, **not a complete Compose override to apply**.
`BONFIRE_IMAGE` is our proposed custom variable, **not a built-in official
recipe feature**. A reviewed last-loaded overlay could instead explicitly
consume `APP_DOCKER_IMAGE`; that is an added override, not evidence the base
composed-tag recipe supports it. Do not change the base image blindly to an
old variable name and assume the current provider config defines it.

The newer expression can mathematically form `repo:tag@sha256:...` by placing
the digest suffix at the end of `APP_PLATFORM`. That tagged-digest syntax is
not inherently invalid, but it overloads a platform field and has **not**
been validated with the provider's Abra/recipe tooling. This guide recommends
the explicit full-reference recipe/overlay for clarity and CI validation,
not presenting that interpolation trick as confirmed deployment support.

If the provider uses an override file, prove that its installed Abra version
actually includes it; never assume it does. Keep the remaining recipe
configs, secrets, networks, uploads volume, service name, hostname routing
and entrypoint unchanged. Record `APP_VERSION`, `APP_FLAVOUR=community`,
`APP_PLATFORM` as metadata even when `BONFIRE_IMAGE` is authoritative.
CI must reject `BONFIRE_IMAGE` without a valid approved SHA-256 digest and
assert the rendered app image matches it; inspect rendered configuration
privately because it can contain sensitive environment values. The provider
must test its recipe fork/deploy method on staging before using production.
For either family, CI must compare the actual final app image field with the
approved digest and inspect platform resolution; no mutable `latest` tag.
Preserve existing DOMAIN, signing-secret references, actor keys/database,
uploads volumes, DB image and enabled overlays. Never regenerate secrets or
create user follows as part of selecting an image.

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

Verified here: canonical RC release/annotated-tag resolution, Community
registry tag metadata, RC app-lock dependency snapshots, all three unchanged
patches dry-run/applied with zero fuzz in temporary copies, and all four
patched Elixir files parsed; archived beta and recipe evidence retained above;
standalone Elixir compilation, formatting and regression results recorded
in the README: **86/86 passed with seeds 0 and 314159**, including nine
PostgreSQL 16.15 cases (both migrations up/down/up), on Elixir 1.18.5 / OTP 27;
warnings-as-errors compilation and format check passed. Fixed test-only
actor-resolver state leakage; no extension production logic changed.
RC targeting recheck: the same 86 tests pass again with both seeds, including
all nine loopback PostgreSQL cases; compilation and formatting pass.
Official recipe audit additionally verified catalogue content, historical
full-reference versus published composed-tag families, current environment,
entrypoint/config-version and backup implementation facts. Override advice
is source-derived, **not tested on the host**; actual recipe revision, rendered
image, backup operation and staging rollout are still provider-run gates.
This documentation-only audit did not rerun the prior 86 tests; no Elixir,
patch or application code changed. No live migration was run. This guide
introduces no deploy script or live connection.

Still required from the host: installed recipe/Abra details, actual image
digest/provenance and matched flavour/dependency revisions; rebase/compile
and test patches in that full Community release; confirm Surface integration,
production release migration runner, immutable recipe override, network and
queue safeguards, backup/restore and staging signed federation interop.
No host access, image build, Fedizen migration, or live S2S delivery was
verified here. Do not describe the extension as installed or production-ready
until those gates pass.