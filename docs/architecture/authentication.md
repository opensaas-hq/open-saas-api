# Authentication, Sessions, and Organizations

> Part of the [Open SaaS API documentation](../README.md). Section numbers are kept from the original architecture guide for traceability.

## 8. Authentication, Sessions, and Organizations

### 8.1 Better Auth ownership

Better Auth owns the entire `/api/auth/*` prefix. The project does **not**
reimplement sign-up, sign-in, sign-out, session lookup, organization management,
or member management over REST.

`createAuth(env, database, options)`:

- Uses `drizzleAdapter` with provider `pg`.
- Maps `user`, `session`, `account`, `verification`, `organization`, `member`,
  `invitation` to the Drizzle schema.
- Sets `secret` and `baseURL`.
- Sets `trustedOrigins = getTrustedOrigins(env)`.
- Forces `advanced.disableOriginCheck = false` even in tests.
- Enables Better Auth rate limiting.
- Configures session `expiresIn` and `updateAge`.
- Declares custom telemetry fields on the session model.
- Enables email/password.
- Revokes sessions on password reset.
- Routes verification and reset emails through `EmailSender`.
- Installs the `organization()` and `bearer()` plugins.
- Adds a session `before` hook that extracts telemetry from request headers.

The factory accepts either a pooled `Database` or a live transaction object. This
is what lets registration run Better Auth writes inside the registration
transaction.

### 8.2 Enabled auth capabilities

- Email + password sign-up/sign-in.
- Email verification email on sign-up; delivery depends on the injected sender,
  and the default sender discards it.
- Password reset email; delivery depends on the injected sender.
- Bearer token support via Better Auth's bearer plugin.
- Organization plugin: create/list/update/delete organizations, invitations,
  membership, active organization selection, member roles.
- Session cookies for browser clients.

The code does not set `requireEmailVerification`, so the current configuration
does not block unverified users from signing in. Verification is routed through
`EmailSender` but not enforced; the default sender discards it, and the
enforcement policy is pending.

### 8.3 Session model and telemetry

Sessions persist:

- `id`, `userId`, `token`, `expiresAt`
- `activeOrganizationId`
- `ipAddress`, `userAgent`
- `browser`, `os`, `deviceType`
- `language`, `timezone`
- `country`, `city`

Telemetry extraction order for IP:

1. `cf-connecting-ip`
2. first value of `x-forwarded-for`
3. `x-real-ip`
4. `127.0.0.1`

Other sources:

- `accept-language` → language
- `x-client-timezone` → timezone
- `cf-ipcountry` → country
- `cf-ipcity` → city
- User-Agent heuristics for browser, OS, and device type

The Better Auth hook preserves its resolved socket IP when the header extractor
falls back to `127.0.0.1`.

### 8.4 Trusted origins

`getTrustedOrigins(env)` returns the de-duplicated union of:

- `BETTER_AUTH_URL`
- comma-separated `TRUSTED_ORIGINS`

The same list feeds Better Auth's CSRF/origin check and API CORS. There is no
wildcard support.

### 8.5 Email policy

`packages/auth/src/email-policy.ts`:

- Normalizes to lowercase and trims.
- Strips plus aliases from the local part.
- For `gmail.com` and `googlemail.com`, also strips dots from the local part.
- Blocks a built-in disposable-domain list:
  `mailinator.com`, `10minutemail.com`, `tempmail.com`, `guerrillamail.com`,
  `trashmail.com`, `yopmail.com`, `dispostable.com`, `getnada.com`,
  `throwawaymail.com`.
- Adds any `DISPOSABLE_EMAIL_DOMAINS`.
- Rejects disposable addresses with 422 `DISPOSABLE_EMAIL_REJECTED`.

Normalization changes the identifier persisted by Better Auth for registration,
but the Better Auth `/api/auth/sign-up/email` endpoint itself does not run this
policy. The project-owned registration endpoint does.

### 8.6 Organization and membership model

- Better Auth's organization plugin writes `organization`, `member`, and
  `invitation` rows.
- Roles used by the application: `owner`, `admin`, `member`.
- The application treats an unknown role as no role, denying access.
- The active organization is stored on the session as
  `activeOrganizationId`.
- `MembershipService` caches role lookups in process memory for
  `MEMBERSHIP_CACHE_TTL_S`.
- Explicit cache invalidation happens only through `MembershipService` methods.
  Organization/member mutations performed directly through Better Auth routes do
  not invalidate this cache; a role change can therefore remain invisible for up
  to the TTL.

---

## 9. Registration Modes

The project-owned registration endpoint is separate from Better Auth's
`/api/auth/sign-up/email` so admission rules can be enforced server-side before
any rows are written.

### 9.1 Mode selection

`REGISTRATION_MODE` is one of:

- `public`
- `waiting_list`
- `invite_code`
- `paid_required`

`StrategyRegistry` maps each mode to exactly one strategy. The `satisfies
StrategyMap` type makes a new mode without a strategy a compile-time failure.
`assertModeIsSupported()` exists for boot assertions, but the current boot path
relies on the exhaustive map rather than calling it explicitly.

### 9.2 Strategy behavior

| Mode | Validation | Result | Side effects |
| --- | --- | --- | --- |
| `public` | None | `active` | None |
| `waiting_list` | None | `waitlist` | `waitlist_entry` row in the registration transaction |
| `invite_code` | Server-side database check; code required | `active` | Atomic consumption of one use in the registration transaction |
| `paid_required` | `PaymentVerificationPort.verify()` | `active` only if verified | Provider-specific; default denies |

The registry built by `apps/api/src/services/registration.service.ts` injects:

- `createDatabaseInviteCodeValidator()` for invite codes.
- The default deny-all payment port for payments.

`createStrategyRegistry` accepts a `payments` port, but the API composition root
hard-wires the deny-all default; there is no configured real provider yet.

### 9.3 Full registration transaction

`registerUser()` in `packages/auth/src/registration/service.ts`:

1. Normalize and validate the email against the disposable-domain policy.
2. Resolve the configured mode's strategy.
3. Run strategy validation **before any writes**.
4. Resolve the organization name (default: `<email> workspace`) and slug
   (default: sanitized email local part plus a base-36 suffix of up to six
   characters).
5. Open `withRawTransaction()` (no tenant GUC; these are framework/root tables).
6. Build a transaction-bound Better Auth instance.
7. `signUpEmail` → creates `user` + credential `account`.
8. Duplicate email → `ConflictError` 409 `EMAIL_ALREADY_REGISTERED`.
9. `createOrganization` → creates `organization` + `owner` membership.
10. Run the strategy's `onCommit` side effect, if any (invite-code consumption).
11. If status is `waitlist`, insert `waitlist_entry`.
12. Commit and return `{ userId, organizationId, organizationSlug, email, status }`.

All rows commit or roll back together. The plaintext password is never stored or
returned; Better Auth hashes it.

### 9.4 Invite-code atomicity

Database validator flow:

1. Read the code outside the transaction for a fast verdict.
2. Return `consume` as an `onCommit` callback.
3. Inside the registration transaction, `consumeRegistrationCode()` runs
   `SELECT ... FOR UPDATE`.
4. Re-check existence, expiry, status, and use count.
5. Increment `use_count`; mark `consumed` when `use_count >= max_uses`.
6. A concurrent loser gets a 409 `INVITE_CODE_ALREADY_USED`.

### 9.5 Audit of registration

After the transaction commits, `RegistrationService` writes:

- action: `registration.completed`
- entity type: `user`
- actor: the new user id
- tenant: the new organization id
- change: `{ status }`

This audit write is outside the registration transaction by design in the
current code. A failure between commit and audit produces a registered user with
no corresponding audit event.

---

## Related

- [Multi-tenancy](multi-tenancy.md)
- [API](api.md)
- [Security](security.md)
- [Development guide](../development-guide.md)
- [Technical debt](../technical-debt.md)
- [Roadmap](../roadmap.md)
