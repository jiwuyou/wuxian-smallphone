# SmallPhone App

P0 skeleton for the SmallPhone product line.

Current scope:

- independent web frontend
- product backend as source of truth
- JSON storage for characters, contacts, threads, messages, memories, reminders
- runtime adapter abstraction with `mock`, `openclaw-cli`, and `openclaw-http` modes

## Run

```bash
cd /root/projects/smallphone/smallphone-active/smallphone-app
npm start
npm run start:openclaw-http
npm run start:cc-connect
```

Open:

- `http://127.0.0.1:22000`

## Runtime modes

Default mode is `mock`.

Environment variables:

```bash
SMALLPHONE_RUNTIME_MODE=mock
SMALLPHONE_RUNTIME_MODE=openclaw-cli
SMALLPHONE_RUNTIME_MODE=openclaw-http
SMALLPHONE_RUNTIME_MODE=openai-compatible
SMALLPHONE_RUNTIME_MODE=cc-connect

SMALLPHONE_OPENCLAW_COMMAND=node
SMALLPHONE_OPENCLAW_ENTRY=/root/projects/smallphone/openclaw/openclaw.mjs
SMALLPHONE_OPENCLAW_AGENT_ID=main
SMALLPHONE_OPENCLAW_MODEL=newxy/gpt-5.4
SMALLPHONE_OPENCLAW_TIMEOUT_MS=120000
SMALLPHONE_OPENCLAW_OPENAI_API_KEY=
SMALLPHONE_OPENAI_BASE_URL=
SMALLPHONE_OPENAI_API_KEY=
SMALLPHONE_OPENAI_MODEL=
SMALLPHONE_OPENAI_REASONING_EFFORT=
SMALLPHONE_OPENCLAW_HTTP_URL=http://127.0.0.1:18789
SMALLPHONE_OPENCLAW_HTTP_TOKEN=
SMALLPHONE_CCCONNECT_WS_URL=ws://127.0.0.1:21010/bridge/ws
SMALLPHONE_CCCONNECT_TOKEN=
SMALLPHONE_CCCONNECT_PROJECT=smallphone
SMALLPHONE_CCCONNECT_PLATFORM=smallphone
SMALLPHONE_CCCONNECT_MANAGEMENT_URL=http://127.0.0.1:21020
SMALLPHONE_CCCONNECT_MANAGEMENT_TOKEN=
SMALLPHONE_CLIENT_ID=smallphone
SMALLPHONE_APP_ID=chat
```

Notes:

- `mock` is for frontend/backend verification only.
- `openclaw-http` is the intended real SmallPhone path when each window should route to a real OpenClaw agent.
- `openai-compatible` directly calls an OpenAI-compatible endpoint and will reuse `~/.codex/config.toml` if env vars are unset.
- `openclaw-cli` shells out to `node openclaw.mjs agent --local --json ...`.
- `openclaw-cli` can force a model with `SMALLPHONE_OPENCLAW_MODEL`, for example `openai/gpt-5.4`.
- If `SMALLPHONE_OPENCLAW_OPENAI_API_KEY` is unset, the adapter falls back to `~/.codex/auth.json` and reuses `OPENAI_API_KEY` when present.
- `openclaw-http` calls the local OpenClaw Gateway `/v1/chat/completions` endpoint.
- `openclaw-http` should pair with a local gateway token and a local-only bind such as `127.0.0.1:18789`.
- `cc-connect` keeps the existing SmallPhone web UI and routes each SmallPhone thread to a cc-connect Bridge WebSocket session.
- `cc-connect` expects the cc-connect development backend bridge to be reachable at `SMALLPHONE_CCCONNECT_WS_URL`; set `SMALLPHONE_CCCONNECT_PROJECT` to the target cc-connect project name.
- SmallPhone permission settings use the cc-connect management API from the SmallPhone backend only. Do not expose `SMALLPHONE_CCCONNECT_MANAGEMENT_TOKEN` to browser code.
- `SMALLPHONE_CLIENT_ID` is optional in the protocol; SmallPhone sets it to `smallphone` so contacts can inherit client-level policy while standalone virtual apps can use only `app_id`.
- Real `openclaw-cli` mode also requires your model/provider auth to already be available to OpenClaw in the current shell or OpenClaw state directory.
- SmallPhone thread workspaces under `data/channel-workspaces/*` are now treated as managed agent workspaces and their bootstrap docs are kept in sync as thread/contact metadata changes.

## API

- `GET /api/bootstrap`
- `GET /api/contacts`
- `GET /api/threads`
- `GET /api/threads/:id/messages`
- `POST /api/threads/:id/messages`
- `GET /api/reminders`
- `POST /api/reminders`
- `GET /api/timeline`
- `GET /api/permissions/templates`
- `GET /api/threads/:id/permissions`
- `POST /api/threads/:id/permissions`
