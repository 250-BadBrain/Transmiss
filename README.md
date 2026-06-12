# transmiss

Fast P2P File Transfer.

## Local Development

```bash
pnpm install
pnpm dev:worker
pnpm dev:web
```

Open:

```text
http://localhost:5173/
```

The local web app connects to:

```text
ws://127.0.0.1:8787/ws
```

## Environment Variables

Frontend variables:

```text
VITE_SIGNAL_URL=wss://relay-transmiss.lab.h2seo4.win/ws
VITE_TURN_USERNAME=
VITE_TURN_CREDENTIAL=
```

For local development, `VITE_SIGNAL_URL` can be omitted. The app defaults to `ws://127.0.0.1:8787/ws` on `localhost` and `127.0.0.1`.

If TURN credentials are omitted, the app uses only:

```text
stun:turn.h2seo4.win:3478
```

When credentials are present, it also uses:

```text
turn:turn.h2seo4.win:3478?transport=udp
turn:turn.h2seo4.win:3478?transport=tcp
```

## Scripts

```bash
pnpm dev:web
pnpm dev:worker
pnpm typecheck
pnpm build
pnpm deploy:worker
```

## Deploy Worker

The Worker is configured in `apps/worker/wrangler.jsonc`.

It provides:

```text
GET /health
GET /ws?roomId=ABCD1234
```

Deploy:

```bash
pnpm deploy:worker
```

Worker custom domain:

```text
relay-transmiss.lab.h2seo4.win
```

Allowed WebSocket origins:

```text
https://transmiss.lab.h2seo4.win
http://localhost:5173
http://127.0.0.1:5173
```

## Deploy Pages

Connect the Git repository in Cloudflare Pages.

Pages settings:

```text
Root directory: /
Build command: pnpm install && pnpm --filter web build
Build output directory: apps/web/dist
Node version: 22
```

Pages environment variables:

```text
VITE_SIGNAL_URL=wss://relay-transmiss.lab.h2seo4.win/ws
VITE_TURN_USERNAME=<your-turn-username>
VITE_TURN_CREDENTIAL=<your-turn-password>
```

`VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL` must be set in Cloudflare Pages and redeployed before production browsers will use TURN.

Pages custom domain:

```text
transmiss.lab.h2seo4.win
```

TURN server:

```text
turn.h2seo4.win
```
