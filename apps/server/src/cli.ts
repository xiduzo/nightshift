/**
 * The entry of `nightshift`, the command line: `bun src/cli.ts <command>`
 * from source. `scripts/build-binary.ts` compiles it into one file, with
 * the web UI and the migrations inside (`setEmbedded`).
 */
import { main } from "./features/cli";

export { main, setEmbedded } from "./features/cli";

if (import.meta.main) await main(process.argv.slice(2));
