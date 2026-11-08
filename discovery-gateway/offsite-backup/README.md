# Private, encrypted offsite logical backups

**Verified 2026-11-08:** Cloudflare R2 is enabled. A dedicated Standard storage bucket
`atlas-discovery-staging-backups` was created in Eastern North America. Cloudflare
accepted 30-day minimum object lock and a 45-day lifecycle expiry for
`gateway-staging/`. **No live encrypted archive has been uploaded/restored.**
The bucket's public `r2.dev` endpoint was independently checked and is **disabled**.
R2 S3 access credentials and an externally recoverable age public recipient
must be configured and verified before backup scheduling is enabled.

## Design

- Separate **short-lived** cron service; no public domain, admin token, gateway actor signing key or volume.
- Source-only `pg_dump --format=custom` from private Railway `Postgres.DATABASE_URL`.
- Ephemeral plaintext temp file with restrictive `umask 077`; `age` encryption with an offline public recipient.
- Upload **only ciphertext** via `rclone` to private Cloudflare R2, then re-download/read-back the
  ciphertext to verify SHA-256 and upload a manifest. The producer has no decryption key.
- Unique timestamp+random object name; fail nonzero on failed dump, encryption, upload,
  read-back or manifest. Rclone uses bounded internal retries.
- Retention and immutable backup lock/lifecycle are **bucket responsibilities**, not
  automatic wildcard deletion from a privileged producer.
- Daily backup is not a PITR guarantee. RPO depends on the last successful verified upload.

## Prerequisite user actions

1. **Completed:** Enable R2 and create private dedicated staging bucket with
   a 30-day minimum lock and 45-day lifecycle for `gateway-staging/`.
2. **Verified:** Public `r2.dev` access is disabled. Review access logs and
   audit policies before production promotion.
3. Create a **bucket-specific** R2 API token allowing object read+write for the
   backup producer (read is needed for SHA-256 read-back); keep delete permissions
   excluded where the provider supports it. Recovery should use a separate
   read-only token wherever possible. Do not reuse a zone/global Cloudflare key.
4. On an offline trusted system, generate an age identity using
   `age-keygen -o <secure-offline-path>`. Securely back up that private
   identity **outside Railway and the backup bucket**. Export only the
   public recipient using `age-keygen -y <secure-offline-path>`.
   Losing the private identity makes encrypted archives unrecoverable.

## Prepared Railway service

Created in **staging only**: `atlas-gateway-r2-backup-staging`
(service ID `cb2be3c4-0ac9-4f74-8a05-03b50c782203`).
Its source root is `/discovery-gateway/offsite-backup`, it uses a Dockerfile,
no public domain, no volume, `restartPolicyType=NEVER` and outbound IPv6
disabled. The service has references to `Postgres.DATABASE_URL`, the dedicated
R2 bucket name and the account-specific S3 endpoint; **no GitHub source is yet
connected and no scheduled deployment or actual database backup occurred**.

Missing secure inputs, to enter **directly in the Railway service Variables UI**,
never in chat or in this repository:

- `RCLONE_CONFIG_R2_ACCESS_KEY_ID` — dedicated bucket-scoped R2 object
  read/write S3 access key ID.
- `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY` — the matching secret.
- `AGE_RECIPIENT` — the `age1...` **public** recipient. Create and retain
  the corresponding `age` identity **offline** with a separate secure copy
  before enabling any schedule.

Once those exist, the source can be connected to the validated main commit,
an initial one-shot backup can run, and a second read-only recovery credential
can verify an actual R2 download and isolated restore. Only after that should
the Railway daily cron be enabled. The connector's OAuth view only exposes
variable **names**, not secret values. Verify by names and actual job output
without trying to read back or log access keys.

## Railway job configuration (do not activate until prerequisites exist)

Create one isolated service from the reviewed GitHub source, with root directory
`/discovery-gateway/offsite-backup` and this directory's Dockerfile.
Use `restartPolicyType=NEVER`, no public domain, no volume. Set variables
**inside Railway**, never in GitHub:

| Name | Value / source |
| --- | --- |
| `SOURCE_DATABASE_URL` | Railway reference `${{Postgres.DATABASE_URL}}` (private) |
| `RAILWAY_ENVIRONMENT_NAME` | Railway-provided `staging` |
| `AGE_RECIPIENT` | Offline age **public** recipient (`age1...`) |
| `BACKUP_REMOTE` | `r2:atlas-discovery-staging-backups` |
| `RCLONE_CONFIG_R2_TYPE` | `s3` |
| `RCLONE_CONFIG_R2_PROVIDER` | `Cloudflare` |
| `RCLONE_CONFIG_R2_ACCESS_KEY_ID` | R2 bucket-scoped token access key |
| `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY` | R2 bucket-scoped token secret |
| `RCLONE_CONFIG_R2_ENDPOINT` | `https://<cloudflare-account-id>.r2.cloudflarestorage.com` |
| `RCLONE_CONFIG_R2_ENV_AUTH` | `false` |

Run one manual deployment first, verify a ciphertext object plus JSON manifest,
download it using the separate recovery credential and **actually decrypt+restore
into a fresh database**. Only then set a Railway cron schedule (e.g. `0 3 * * *`
UTC, daily). The job exits after each backup. Add an independent monitor for a
missing or stale completed manifest, plus alert delivery and periodic restore
drills. Backups are **not** proof of durability until their retention and
restores have been independently tested.

## Validation and limitations

`gateway-offsite-backup.yml` builds the non-root image, creates synthetic
PostgreSQL source/restore containers, generates a CI-only age keypair, verifies
that unsafe destinations are rejected, runs the encryption/upload/read-back
against an isolated local rclone destination and decrypts/restores using a
**separate recovery step**. CI never accesses Railway's live database or R2.

## Safe recovery helper

The image now also provides `/usr/local/bin/atlas-recover`. Supply a downloaded
`*.pgcustom.age`, its associated `*.manifest.json`, an **offline recovery**
`age` private-key file, and a separate empty PostgreSQL destination.
Set `RECOVERY_CONFIRM=isolated-empty-target`; production-mode runs must have
`RAILWAY_ENVIRONMENT_NAME=staging` and a private Railway destination.
Before decryption, the helper checks manifest syntax/version, SHA-256 and exact
ciphertext length. It refuses a nonempty database, then decrypts only to a
short-lived private temporary directory, checks the custom PG archive and
performs an error-checked restore. The identity is never logged or included
in the backup producer container.

A manifest stored **with** a ciphertext is an integrity check against accidental
corruption, not an authenticated provenance guarantee against an adversary who
can replace both. Stronger storage immutability or an offline-signed manifest
remains necessary to resist malicious replacement. Never interpret a
successful restore as sufficient by itself to satisfy live RPO/RTO.

The test validates implementation mechanics. It does **not** prove actual R2
authorization, backup object lock, cross-provider availability, scheduler firing,
WAL recovery, live staging encryption retention, or an operational RTO. Those
remain explicit production release gates in [issue #23](https://github.com/outlaw-dame/aura-social-atlas/issues/23).
