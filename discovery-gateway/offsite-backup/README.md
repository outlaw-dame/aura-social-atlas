# Private, encrypted offsite logical backups

This is a **prepared implementation**, NOT a deployed/scheduled backup. The staging account's
Cloudflare API returned `10042` ("Please enable R2 through the Cloudflare Dashboard").
Until the R2 subscription is activated and an encrypted archive is uploaded and
restored from that real account, Atlas has **no independently retained offsite backup**.

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

1. Cloudflare → **Storage & databases → R2 → Overview** → activate R2 billing/subscription
   (R2 has free monthly usage, but usage-based billing/checkout is required).
2. Create one **private** R2 bucket scoped solely to Atlas staging. Do not enable
   public `r2.dev` access or a public custom domain. Configure bucket lifecycle
   retention and account access auditing.
3. Create a **bucket-specific** R2 API token allowing object read+write for the
   backup producer (read is needed for SHA-256 read-back); keep delete permissions
   excluded where the provider supports it. Recovery should use a separate
   read-only token wherever possible. Do not reuse a zone/global Cloudflare key.
4. On an offline trusted system, generate an age identity using
   `age-keygen -o <secure-offline-path>`. Securely back up that private
   identity **outside Railway and the backup bucket**. Export only the
   public recipient using `age-keygen -y <secure-offline-path>`.
   Losing the private identity makes encrypted archives unrecoverable.

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
| `BACKUP_REMOTE` | `r2:<private-bucket-name>` |
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

The test validates implementation mechanics. It does **not** prove actual R2
authorization, backup object lock, cross-provider availability, scheduler firing,
WAL recovery, live staging encryption retention, or an operational RTO. Those
remain explicit production release gates in [issue #23](https://github.com/outlaw-dame/aura-social-atlas/issues/23).
