# Pocket ID OIDC for the dashboard

Research for [#3](https://github.com/tedkulp/botty/issues/3), done 2026-10-26.
Question: how does a TypeScript web dashboard sign Admins in against a self-hosted Pocket ID over OIDC? This covers discovery, scopes, the group claim, sessions, and which TS library to use.

Sources are the Pocket ID backend at tag `v2.19.1` (the latest release), the Pocket ID docs site source in [pocket-id/website](https://github.com/pocket-id/website), and the docs, READMEs or npm metadata for each library.

## TL;DR

- Make Botty a **confidential client** that uses the authorization code flow with PKCE (S256). Discovery is at `<APP_URL>/.well-known/openid-configuration`.
- Request the scopes `openid profile email groups`.
- **Pocket ID does the Admin gate itself.** Restrict the OIDC client to an "Admins" user group (Access tab). Anyone outside that group is stopped at Pocket ID with "You are not allowed to access this service" and never reaches the callback. The same check runs again on every refresh.
- The dashboard should still check that the `groups` claim (an array of group **names**) contains the Admin group, so a misconfigured client can't let everyone in.
- Library: use **openid-client v6** with our own session cookie, or **better-auth**'s `genericOAuth` plugin if we want sessions handled for us. **Lucia and Arctic are deprecated**, and Auth.js now points new projects to Better Auth.

## Discovery and endpoints

Pocket ID serves standard OIDC discovery at `/.well-known/openid-configuration`. The issuer is the `APP_URL`. ([connect-an-app.mdx](https://github.com/pocket-id/website/blob/main/src/content/docs/docs/setup/connect-an-app.mdx); `backend/internal/controller/well_known_controller.go` `computeServerMetadata`)

What the discovery document advertises (`well_known_controller.go`):

| Field | Value |
| --- | --- |
| `authorization_endpoint` | `APP_URL/authorize` |
| `token_endpoint`, `userinfo_endpoint`, `jwks_uri`, `introspection_endpoint` | `INTERNAL_APP_URL/...` |
| `end_session_endpoint` | `APP_URL/api/oidc/end-session` (RP-initiated logout) |
| `response_types_supported` | `code` only |
| `grant_types_supported` | authorization_code, refresh_token, device_code, client_credentials |
| `code_challenge_methods_supported` | `plain`, `S256` |
| `token_endpoint_auth_methods_supported` | `client_secret_basic`, `client_secret_post`, `none` |
| `id_token_signing_alg_values_supported` | the key's alg. RS256 by default ([scopes-and-claims.md](https://github.com/pocket-id/website/blob/main/src/content/docs/docs/guides/scopes-and-claims.md)) |
| `authorization_response_iss_parameter_supported` | `true` |
| `backchannel_logout_supported` | `true` |
| `pushed_authorization_request_endpoint` | present, not required |

Deployment gotcha: the token, userinfo and JWKS URLs use `INTERNAL_APP_URL`, which is set separately from `APP_URL`. The bot's server calls these endpoints directly, so "the issuer URL has to work from the app's container too, not only in your browser" ([connect-an-app.mdx](https://github.com/pocket-id/website/blob/main/src/content/docs/docs/setup/connect-an-app.mdx)).

Client types: confidential clients (they have a backend) authenticate with the client secret. Public clients use PKCE with no secret. A client can also be set to require PKCE (`PkceEnabled`) ([connect-an-app.mdx](https://github.com/pocket-id/website/blob/main/src/content/docs/docs/setup/connect-an-app.mdx); `backend/internal/model/oidc.go`). The dashboard has a server, so it should be a **confidential client and also send PKCE S256**. The secret is shown only once when the client is created. Federated client credentials (JWT client assertions) exist too, but they are only worth it on Kubernetes or Azure-style platforms ([oidc-client-authentication.mdx](https://github.com/pocket-id/website/blob/main/src/content/docs/docs/guides/oidc-client-authentication.mdx)).

## Scopes and claims

From [scopes-and-claims.md](https://github.com/pocket-id/website/blob/main/src/content/docs/docs/guides/scopes-and-claims.md), confirmed in `backend/internal/oidc/claims_service.go` `GetUserClaims`:

| Scope | Claims |
| --- | --- |
| `openid` | `sub`, the user's ID, which never changes |
| `profile` | `name`, `given_name`, `family_name`, `preferred_username`, `display_name`, `picture`, plus custom claims |
| `email` | `email`, `email_verified` (only when the user has an email) |
| `groups` | `groups`: an array of group **names** |
| `offline_access` | no claims. Pocket ID issues refresh tokens without this scope |

- The **ID token and the userinfo response carry the same claims** (`applyIDTokenClaims` and `userinfo_handler.go` both call `GetUserClaims`). The access token does not carry custom claims.
- `groups` holds each group's `Name`, such as `admins`, not the friendly name shown in the admin UI.
- Custom claims (set per user or group) come with `profile`. The names `groups`, `email`, `sub` and similar are reserved and can't be used for custom claims.
- Use `sub` as the Admin's stable key. Don't use `email` or `preferred_username`, because both can change.
- Lifetimes: ID token 1 h. Access token 60 min, configurable per client. Refresh token is opaque and lasts 30 days of inactivity, configurable. Auth code 15 min.
- **OIDC Data Preview** on the client page shows exactly what a given user's tokens will contain. That is handy for checking the Admin group setup.

## Restricting sign-in to an Admin group

Pocket ID enforces this server-side, per client ([allowed-groups.mdx](https://github.com/pocket-id/website/blob/main/src/content/docs/docs/configuration/allowed-groups.mdx)):

- On the client's **Access** tab, choose **Selected user groups** and tick the Admin group.
- A client created in the admin UI starts with *Selected user groups* and **no group ticked**, so nobody can sign in until a group is chosen. Clients created through the API are open to all users by default.
- A user outside the allowed groups gets "You are not allowed to access this service" at Pocket ID and is not redirected back to the app. In code, `IsUserGroupAllowedToAuthorize` in `backend/internal/oidc/authorization_service.go` returns `fosite.ErrAccessDenied`.
- Pocket ID re-checks group membership (and that the user isn't disabled) **at every refresh**. Removing someone from the group ends their access at the app's next token refresh ([scopes-and-claims.md](https://github.com/pocket-id/website/blob/main/src/content/docs/docs/guides/scopes-and-claims.md)).

Recommendation: do both checks. Rely on Pocket ID's allowed groups, and in the callback also require `groups.includes(ADMIN_GROUP)` (the group name comes from config) before creating a session. The cost is one line. It protects against the client being switched to "All Users" by mistake.

## Session handling

Pocket ID ends at the token response. The dashboard owns its own session. Options:

1. **Own session cookie.** On callback, validate the ID token, check `groups`, and write a signed, httpOnly, SameSite=Lax cookie (or a server-side session row) keyed by `sub`. Revocation is our job: either keep sessions short, or store the refresh token and refresh periodically, so Pocket ID's per-refresh group re-check actually takes effect.
2. **Library-managed session** (better-auth, below).

During the redirect, the app has to keep `state` and the PKCE `code_verifier` somewhere, usually a short-lived cookie. The openid-client README says outright that this is the app's job.

Logout: clear our cookie. Optionally redirect to `end_session_endpoint` with `id_token_hint` and `post_logout_redirect_uri`, which must be listed in the client's Logout Callback URLs (`LogoutCallbackURLs` in `model/oidc.go`). Back-channel logout is supported if we ever want Pocket ID to push logouts to us.

## TS library options

| Library | Status (2026-10) | Fit |
| --- | --- | --- |
| [openid-client](https://github.com/panva/openid-client) v6.8.8 | Maintained (panva). Only supported major is v6. Deps are `jose` and `oauth4webapi` | Certified, spec-strict RP. Functional API: `discovery()`, `randomPKCECodeVerifier()`/`calculatePKCECodeChallenge()`, `buildAuthorizationUrl()`, `authorizationCodeGrant()`, `refreshTokenGrant()`, `buildEndSessionUrl()`. It validates the ID token. **No session handling.** It is ESM; Node 20.19+/22.12+ can `require` it. Framework-agnostic, so it suits a bot process that also serves the dashboard. |
| [better-auth](https://www.better-auth.com/docs/plugins/generic-oauth) 1.7.x | Actively maintained. Auth.js has joined it | The `genericOAuth` plugin takes `discoveryUrl`, `scopes`, and `pkce: true` (the default). Callback is `/api/auth/callback/:providerId`. Read `groups` with `getUserInfo`/`mapProfileToUser` (set `requireIdTokenVerification: true` when trusting ID token claims), and reject with `user.validateUserInfo` returning `{ error }`. Handles sessions, by default in a DB, or in [stateless mode](https://www.better-auth.com/docs/concepts/session-management) (signed or encrypted cookie) when no DB is configured. There is no Pocket ID helper, but the generic config is enough. |
| [Auth.js](https://github.com/nextauthjs/next-auth) (`@auth/core`, `@auth/express` 0.12.x) | The README says it is now part of Better Auth and recommends Better Auth for new projects | Works as a generic OIDC provider (it ships Keycloak and Authentik providers, none for Pocket ID). Not recommended for new code. |
| [Lucia](https://lucia-auth.com) | npm package **deprecated** (v3.2.2). Now a learning resource | Don't use it. Its guide describes the hand-rolled session approach of option 1. |
| [Arctic](https://arctic.pilcrowonpaper.com/) | **Deprecated July 2026** (v3.7.0). The npm page says it is no longer supported | Don't use it. It was OAuth 2.0 only, with no discovery or ID token validation. |

### Recommendation

- If the dashboard is a small server living in the bot process (Express, Fastify, Hono, and so on), use **openid-client v6 plus our own signed-cookie session**. That is about 100 lines and a single dependency, it is spec-correct, and we keep full control of the Admin check and the session lifetime.
- If we expect to want more of what an auth framework gives (DB-backed sessions, account tables, several providers later), use **better-auth `genericOAuth`**.
- Either way, the Pocket ID side is the same: one confidential client, callback `https://<dashboard>/<callback path>`, allowed group = Admins, scopes `openid profile email groups`.

## Sketch (openid-client v6)

```ts
import * as oidc from "openid-client";

const config = await oidc.discovery(new URL(process.env.POCKET_ID_URL!), CLIENT_ID, CLIENT_SECRET);

// /login
const verifier = oidc.randomPKCECodeVerifier();
const state = oidc.randomState();
// store verifier + state in a short-lived httpOnly cookie
const url = oidc.buildAuthorizationUrl(config, {
  redirect_uri: REDIRECT_URI,
  scope: "openid profile email groups",
  code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
  code_challenge_method: "S256",
  state,
});

// /callback
const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
  pkceCodeVerifier: verifier,
  expectedState: state,
});
const claims = tokens.claims()!; // validated ID token claims
if (!(claims.groups as string[] | undefined)?.includes(ADMIN_GROUP)) throw forbidden();
// create session keyed by claims.sub
```
