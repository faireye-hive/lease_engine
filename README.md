# Lease Engine

A clean, open-source request marketplace for **Hive Engine stake delegations**. Community members can advertise that they want to rent voting/tribe power, and token holders can publish their interest. Listings and responses are signed by the user's Hive account and recorded on Hive as `custom_json`.

**Status: first-stage request board, not an escrow or enforceable leasing contract.**

## Features

- Responsive light-mode marketplace (mobile and desktop).
- Discover *currently delegable* tokens using Hive Engine's `tokens` table (no hardcoded assumption that LEO/POB/VYB support delegation).
- Post a request specifying token power, quantity, duration, total offered payment and a short note.
- Publish an interest message on-chain, or cancel your own request.
- Browse by token, status and account, with a few sorting options.
- Hive Keychain signs app operations with **posting authority**. The service never receives keys.
- Public indexer validates Hive posting authority directly from irreversible blocks.
- Optional PostgreSQL-backed chain cursor and event storage (required for reliable deployment).
- No custodial funds, no automatic payments, and no claim that offers have been fulfilled.

## Project layout

```
public/index.html       Website
public/styles.css       Responsive styling
public/app.js           Browser logic and Hive Keychain
server/index.mjs        Express server + irreversible Hive block indexer
server/protocol.mjs     Signed custom JSON validation and event reducer
tests/protocol.test.mjs Validation tests
render.yaml             Render web-service blueprint
```

## Local development

Requires Node.js 20+.

```bash
git clone https://github.com/faireye-hive/lease_engine.git
cd lease_engine
npm install
npm test
npm run dev
# http://localhost:3000
```

Local development can run without PostgreSQL, but the indexer uses memory and loses its cursor and history when restarted.

## Visual preview on GitHub Pages

The repo includes a GitHub Actions workflow at `.github/workflows/pages.yml` to publish the `public/` site as a **demo-only visual preview**. All listings and supported tokens in this preview are fictional; Keychain transactions and lease payments are disabled.

To activate Pages, an administrator may need to open **Settings → Pages → Build and deployment → Source: GitHub Actions**. The workflow publishes the static files at `https://faireye-hive.github.io/lease_engine/` after GitHub Pages is enabled and the run succeeds.

This preview has no database or API. Production functionality requires the Node.js backend below.

## Deploy on Render

1. Create a managed **PostgreSQL** database and inspect its pricing/plan before proceeding.
2. Deploy this repo as a Render **Web Service**, with `npm install` as build command and `npm start` as start command. Or use the included `render.yaml` blueprint for the web service.
3. Set the `DATABASE_URL` environment variable to the database's internal connection URL. Use `DATABASE_SSL=true` only if your connection requires SSL; if enabled, configure certificate verification for your environment.
4. Verify `/api/health`: storage must say `postgres`, the indexed block must increase, and `blocksBehind` should approach zero.
5. Make a test posting with Hive Keychain. A request appears only after an irreversible block has been indexed.

The `render.yaml` **does not provision a paid database**. It declares a `DATABASE_URL` that must be configured during setup. Without a persistent database, Render restarts/suspensions can cause a loss of the locally indexed marketplace history. A sleeping instance will backfill from its saved cursor on restart but may take time to catch up.

## Operations and trust model

Marketplace custom JSON ID: `lease.engine`. These are separate from Hive Engine's `ssc-mainnet-hive` contract operations.

**Request** (Hive posting authority):
```json
{
  "v": 1,
  "type": "request",
  "id": "11111111-1111-4111-8111-111111111111",
  "symbol": "LEO",
  "quantity": "1000",
  "days": 30,
  "price": "5.000",
  "paySymbol": "SWAP.HIVE",
  "note": "Looking to lease power",
  "expiresAt": "2026-11-20T12:00:00.000Z"
}
```

**Interest**:
```json
{"v":1,"type":"interest","id":"33333333-3333-4333-8333-333333333333","requestId":"11111111-1111-4111-8111-111111111111","note":"I am interested in delegating"}
```

**Cancellation**:
```json
{"v":1,"type":"cancel","id":"22222222-2222-4222-8222-222222222222","requestId":"11111111-1111-4111-8111-111111111111"}
```

Indexing verifies the **actual on-chain posting account** rather than trusting a username in the JSON. Only the original requester can cancel. A participant can express interest once for a given request. Expired requests close automatically in the UI.

The indexer reads Hive's `last_irreversible_block_num` and `block_api.get_block_range`. On first launch, it begins `START_BACKFILL_BLOCKS` blocks behind the irreversible head (default: 1,200). Subsequent boots continue from the persisted database cursor. It reads at most 40 blocks per batch, with a short pause between batches.

### API

- `GET /api/health`: index height, lag and backend health.
- `GET /api/tokens`: Hive Engine delegation-enabled tokens (cached for 5 minutes).
- `GET /api/requests`: signed marketplace requests and interested accounts; optional `?symbol=LEO&status=open&account=alice`.

## Payment and escrow: **not yet implemented**

Normal Hive escrow operations govern Hive-native transfers. They **do not automatically enforce** a timed Hive Engine delegation, renewal, payment schedule, or undelegation. Delegations can be removed by their owners; undelegations can also be subject to token-specific cooldowns. A simple deposit to an operator is not equivalent to escrow.

Before adding paid leases, design and independently review an appropriate Hive Engine smart contract (or another independently verifiable settlement mechanism) that can securely custody **only the agreed payment**, verify the delegation on the sidechain, handle early revocation, refunds, dispute conditions and explicit settlement timing. Until such a mechanism is audited and deployed, do **not** collect funds or display payments as secured.

In this version the displayed price is the **total payment proposed for the whole requested duration**, not APR or a verified commitment. Listings and interest messages are only public proposals. The platform does not verify token balances, ability to delegate, ownership of off-chain identities, or contractual performance.

## Security design

- No private keys, passwords or direct wallet custody.
- Posting authority for app messages, not the active authority used to delegate/transfer tokens.
- Only validated event types and fields are indexed; on-chain authorship is checked.
- User-submitted text is inserted using `textContent` to avoid HTML injection/XSS.
- Indexer reads irreversible blocks and tracks a persistent cursor with idempotent event keys.
- Never interpret an interest message as a completed contract.
- Public data and event immutability: cancellations append a new event; the original request remains on-chain.

## Useful references

- Hive Engine contract docs: https://hive-engine.github.io/engine-docs/actions/
- Hive Keychain documentation: https://github.com/hive-keychain/hive-keychain-extension/blob/master/documentation/README.md
- Hive block API: https://developers.hive.io/apidefinitions/block-api.html

