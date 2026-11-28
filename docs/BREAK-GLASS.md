# Break-Glass Owner Recovery

Use this CLI-only procedure when the project owner has lost access to the `OWNER` account or suspects an `OWNER` account is compromised and needs to promote an existing user to `OWNER` (and optionally demote the compromised account and revoke all of its sessions).

**No web route, API endpoint, or UI exists for owner recovery by design.** Production database access is controlled by your Supabase credentials (`DIRECT_URL`), so keep `.env` and Supabase credentials safe and never share or commit them.

## StaffAllowlist Behaviour

Staff login (`/staff/login`) derives the user's role from `StaffAllowlist` and requires an active row. Because of this, the break-glass tool manages both `User.role` and `StaffAllowlist`:

- **Promote (`--email`)**: sets `User.role = OWNER` and creates or updates the `StaffAllowlist` row for that email to `role = OWNER`, `active = true`, `removedAt = null`.
- **Demote (`--demote-email`)**: sets `User.role = CUSTOMER`, deletes all `Session` rows for that user, and deactivates its `StaffAllowlist` row (`active = false`, `removedAt = <now>`). It never creates or deletes allowlist rows.

## Prerequisites

1. Run from the **repository root** in **PowerShell** on the owner's machine.
2. Ensure `.env` exists and contains `DIRECT_URL` (falls back to `DATABASE_URL` if `DIRECT_URL` is unset).
3. The target `--email` user **must already exist** in the `User` table (the script never creates new users).

## Commands

### 1. Dry run (default — writes nothing)

Inspect the target DB host, user ID, current role, allowlist action, and planned changes without modifying the database:

```powershell
node --env-file=.env scripts/break-glass-owner.mjs --email owner-recovery@example.com
```

Dry run with demotion:

```powershell
node --env-file=.env scripts/break-glass-owner.mjs --email owner-recovery@example.com --demote-email compromised-owner@example.com
```

### 2. Apply — promote only

Promotes the existing target user to `OWNER`, ensures an active `OWNER` row in `StaffAllowlist`, and writes a `break_glass.owner_promote` `AuditLog` entry. You will be prompted interactively to re-type the target email to confirm:

```powershell
node --env-file=.env scripts/break-glass-owner.mjs --email owner-recovery@example.com --apply
```

### 3. Apply — promote + demote and revoke sessions

Promotes the target user to `OWNER` (with an active `OWNER` allowlist row), demotes `--demote-email` to `CUSTOMER`, deactivates its `StaffAllowlist` row, deletes all `Session` rows for the demoted user, and writes both `break_glass.owner_promote` and `break_glass.owner_demote` `AuditLog` entries in a single transaction:

```powershell
node --env-file=.env scripts/break-glass-owner.mjs --email owner-recovery@example.com --demote-email compromised-owner@example.com --apply
```

## After Use

1. **Verify access**: Sign in at `/staff/login` with the promoted email and confirm the role in `/admin/team`.
2. **Rotate credentials**: Rotate the demoted account's credentials/access and any shared secrets that may have been exposed.
3. **Review AuditLog**: Check the `AuditLog` table for `break_glass.owner_promote` and `break_glass.owner_demote` entries (`meta: { via: "cli", previousRole, allowlist }`).
