import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { CliConfig, LayerLive, t3Cli } from "./main";
import { OpenLive } from "./open";
import { Command } from "effect/unstable/cli";
import { version } from "../package.json" with { type: "json" };
import { ServerLive } from "./wsServer";
import { NetService } from "@t3tools/shared/Net";
import { FetchHttpClient } from "effect/unstable/http";
import { maybeCreatePatchCliProgram } from "./patch/cli.ts";

const RuntimeLayer = Layer.empty.pipe(
  Layer.provideMerge(CliConfig.layer),
  Layer.provideMerge(ServerLive),
  Layer.provideMerge(OpenLive),
  Layer.provideMerge(NetService.layer),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(FetchHttpClient.layer),
);

const patchCliProgram = maybeCreatePatchCliProgram(process.argv.slice(2));
if (patchCliProgram) {
  patchCliProgram.pipe(
    Effect.provide(
      LayerLive({
        mode: Option.none(),
        port: Option.none(),
        host: Option.none(),
        t3Home: Option.none(),
        devUrl: Option.none(),
        noBrowser: Option.none(),
        authToken: Option.none(),
        bootstrapFd: Option.none(),
        autoBootstrapProjectFromCwd: Option.none(),
        logWebSocketEvents: Option.none(),
      }),
    ),
    Effect.provide(RuntimeLayer),
    NodeRuntime.runMain,
  );
} else {
  Command.run(t3Cli, { version }).pipe(Effect.provide(RuntimeLayer), NodeRuntime.runMain);
}
