# desktop-ui

Static frontend dist served by the Tauri desktop shell
([`../desktop-shell`](../desktop-shell)).

## What this is

This directory holds the **rendered frontend** that Tauri serves as the
desktop dashboard (spec §25.3). It is intentionally a plain, self-contained
`index.html` — no build step, no external scripts, no module bundler. Tauri's
`frontendDist` setting points here:

```jsonc
// ../desktop-shell/tauri.conf.json
{ "build": { "frontendDist": "../desktop-ui" } }
```

## What this is NOT

- **Not a Rust crate.** There is no `Cargo.toml` here, and it is deliberately
  excluded from the Cargo workspace members. It is a static asset directory, so
  `desktop-ui/` will correctly appear as an "orphan" to a workspace-only audit.
- **Not a build artifact target.** The HTML is hand-authored and versioned
  (it mirrors the runtime in `packages/web`/`packages/desktop`), not emitted by
  a bundler.

## Runtime contract

The page expects (see the comment header in `index.html`):

- `window.__TAURI__` enabled (`app.withGlobalTauri: true` in `tauri.conf.json`),
- Tauri v2 IPC commands: `gateway_info`, `deep_link_take_pending`,
- Tauri events: `sidecar://state`, `deep-link://received`.

In a plain browser (dev fallback) the page still renders and polls the gateway
directly; every `invoke()` is wrapped so missing handlers degrade gracefully.
