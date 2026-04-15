# T3 Code

T3 Code is a minimal web GUI for coding agents (currently Codex and Claude, more coming soon).

## How to use

> [!WARNING]
> You need to have [Codex CLI](https://github.com/openai/codex) installed and authorized for T3 Code to work.

```bash
npx t3
```

You can also just install the desktop app. It's cooler.

Install the [desktop app from the Releases page](https://github.com/pingdotgg/t3code/releases)

## Patch Layer Branch

This branch (`feat/patch-layer`) adds a fork-aware patch workflow for keeping a customized fork aligned with upstream in a sandbox worktree.

To test this exact branch on another machine:

```bash
git clone https://github.com/BurgessTG/t3code.git
cd t3code
git checkout feat/patch-layer
bun install
bun fmt
bun lint
bun typecheck
bun run test
```

For local reconcile testing without GitHub:

```bash
bun run patch:fixture -- --scenario clean
```

See [docs/patch-layer-local-testing.md](./docs/patch-layer-local-testing.md) for the fixture flow, expected scenarios, and manual validation loop.

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

## If you REALLY want to contribute still.... read this first

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
