# Patch Layer Local Testing

Use the local fixture generator to simulate a fork that diverges from upstream without pushing anything to GitHub.

## Fresh Machine Setup

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

If you are working from an upstream clone instead of the personal fork clone, add a separate fork remote before pushing anything and do not push to `pingdotgg/t3code`.

## Create a fixture

```bash
bun run patch:fixture -- --scenario clean
```

Available scenarios:

- `clean` — replay should succeed and land in `ready_for_review`
- `content-conflict` — replay should stop in a content conflict
- `rename-conflict` — replay should stop in a rename/delete style conflict
- `validation-failure` — replay should succeed, then fail validation

The command prints a fixture root plus a generated `README.md` with exact `t3 patch ...` commands for that scenario.

## Recommended loop

1. Run `patch status` against the generated fork workspace.
2. Run `patch init` with the scenario-specific validation commands from the fixture README.
3. Run `patch reconcile`.
4. Run `patch status` again and compare the resulting state with the scenario expectation.
5. For successful runs, inspect the sandbox with `patch open-sandbox` before trying `patch apply`.

## Manual UI Pass

After the automated CLI flow is green, do a manual pass in the app:

1. Start the app with `bun run dev` or `bun run dev:desktop`.
2. Create a local fixture with `bun run patch:fixture -- --scenario clean`.
3. Open the generated fork workspace and use the Patch control in the chat header.
4. Confirm the app shows the expected ahead/behind status before reconcile.
5. Run reconcile, inspect the review state, and verify the sandbox path matches the generated fixture output.
6. Repeat with `content-conflict` to confirm the UI surfaces a blocked/manual-review state.

## Notes

- The fixture creates local bare remotes for both `upstream` and `origin`.
- Nothing is pushed outside your machine.
- The patch service now recognizes local path remotes like `/.../pingdotgg/t3code.git` and file URLs like `file:///.../pingdotgg/t3code.git`, so the same fork detection flow can be exercised locally.
