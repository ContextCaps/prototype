# Privy wallet onboarding

This branch adds email login and an Ethereum embedded wallet through Privy.
The connected embedded wallet signs the existing root registration/revocation
calldata on Monad Testnet. Contracts, broker policy, and agent tools are unchanged.

## Dashboard

1. Create a **ContextCaps** app at https://dashboard.privy.io/.
2. Enable Email login and Ethereum embedded wallets.
3. Allow `http://127.0.0.1:5173` and `http://localhost:5173` as development origins.
   Add the exact deployed frontend origin before publishing.
4. Copy the public **App ID**. This integration does not need an App Secret.

## Frontend

Add to `apps/web/.env.local`:

```dotenv
VITE_WALLET_PROVIDER=privy
VITE_PRIVY_APP_ID=<public App ID>
```

Never put an App Secret/private key in `VITE_*`: these variables are bundled
into the browser. Restart Vite after changing the env file.

The SDK config uses Email login, automatic embedded-wallet creation for all
users, visible wallet signing prompts, and only Monad Testnet (chain `10143`).
The selected account is always a Privy embedded Ethereum wallet, including
the SDK's supported embedded-wallet variants; a linked external wallet is not
silently selected for signing.

If wallet creation did not complete, a logged-in user can select **Create Privy
wallet** to retry. SDK readiness gates actions. Login/logout and account changes
are reflected in the UI. A grant remains bound to its original principal;
reconnect that wallet before run/revoke/retry. Logout is not revocation.

## Broker

Use the existing wallet mode in root `.env`:

```dotenv
CHAIN_PROVIDER=monad
PRINCIPAL_SIGNING=wallet
CONTEXTCAPS_REGISTRY_ADDRESS=0xE366af2032Bc4e581F533806640185a5b0eA3FB2
```

The broker's `MONAD_PRIVATE_KEY` must belong to the registry's `receiptWriter`
operator, not the new Privy user. Operator funds cover child grants and receipts;
the user funds root grant/revoke. Configure `RECEIPT_HMAC_KEY` as before.
The current registry operator is recorded in the deployment manifest.

From `prototype`:

```powershell
npm install
npm run start:broker
# In another terminal:
npm run dev:web
```

Open `http://127.0.0.1:5173/demo/`, log in with Email, and copy the displayed
embedded wallet address to https://faucet.monad.xyz/. It needs testnet MON for
gas; gas sponsorship is not implemented here.

Verify authorize → ACTIVE → run → revoke → REVOKED → retry denied using the
same embedded wallet. Record this real flow before claiming Privy integration
in a sponsor submission. Without a valid App ID/dashboard setup, live login
cannot be validated; the UI shows configuration status instead of simulating it.

## Existing wallet flow

Set `VITE_WALLET_PROVIDER=injected` to keep the MetaMask/injected-wallet flow.
If the provider setting and App ID are both absent, that is also the default.
An explicitly selected Privy mode without an App ID blocks authorization and
reports the missing configuration; it does not silently fall back to MetaMask.

## Security boundary

Privy handles frontend authentication and user-controlled wallet signing.
This change does **not** add Privy access-token verification or owner middleware
to the broker. Existing principal endpoints remain unsuitable for an untrusted
multi-user production deployment without those additional controls. No user
private key or App Secret is exported to the application or sent to the broker.

References: https://docs.privy.io/basics/react/setup,
https://docs.privy.io/basics/react/advanced/automatic-wallet-creation,
https://docs.privy.io/basics/react/advanced/configuring-evm-networks.
