/**
 * `bun run join <host-address> [--guest]`: `nightshift join` from source.
 * See `features/cli/join.ts`.
 */
import { joinCommand } from "./features/cli";

await joinCommand(process.argv.slice(2), "bun run join");
