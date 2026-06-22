# SmallPhone OpenHouse Component Notes

SmallPhone is the phone desktop shell. It should open to the desktop first, then launch registered apps such as Messages, SillyTavern, and controlled browser entries.

## Registry

SmallPhone reads component manifests from:

```text
~/.config/openhouseai/components.d/*.json
```

Each manifest uses the OpenHouse four-layer schema:

- `id`: stable component id.
- `title` or `name`: user-facing app name.
- `kind`: component type, such as `core-app`, `ai-partner`, or `controlled-browser`.
- `shellMenu`: Android app shell sidebar registration.
- `smallphoneApp`: SmallPhone desktop app registration.
- `serviceManager`: service/control/logs/repair registration.
- `ai`: AI-readable component documentation and intent mapping.

SmallPhone consumes only `smallphoneApp` for desktop icons and app entry. The Android app consumes `shellMenu`. A component may appear in both, one, or neither. Service actions go through service-manager refs/API declared in `serviceManager`; component manifests must not contain `command`, `shell`, `script`, or `args`.

SmallPhone Core exposes the registry for AI runtime consumers:

- `GET /api/components`: sanitized component registry.
- `GET /api/ai-capabilities`: AI-readable summaries, parsed capability JSON, intents, and service-manager refs loaded from each component's `ai.summaryDoc` and `ai.capabilities`.

AI runtimes should call these APIs instead of scanning `~/.config/openhouseai` directly.

`smallphoneApp.entry.type` supports:

- `native-view`: opens a bundled SmallPhone view such as `messages` or `sillytavern`.
- `webview`: opens the registered URL inside the dynamic app WebView.

`smallphoneApp.controlEntry.type` may be `service-control` with `serviceNames`; those names must refer to `serviceManager.services[*].name`.

## Messages

Component id: `messages`

The Messages app is an independent SmallPhone desktop app registered through `smallphoneApp.staticAppId: "messages"`. It contains the Claude Code, OpenCode, and Codex contacts. Use it when the user wants to talk with an AI agent or continue a conversation. If `messages.json` has `smallphoneApp.visible: false`, the desktop hides the Messages icon, but existing chat data and backend routes remain available.

## SillyTavern

Component id: `sillytavern`

SillyTavern is an AI partner app managed from the SmallPhone desktop. Use the component's `serviceManager` services for start, stop, restart, status, logs, and repair.

## Controlled Browser

Component id: `controlled-browser`

The controlled browser is a webview-style component opened from its registered URL. AI should not guess browser commands from this file; it should use the controlled browser service and its own capability description when that component is installed.
