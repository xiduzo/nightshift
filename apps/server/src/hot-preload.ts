/**
 * The preload of the dev entry: `bun run dev` runs it before `main.ts`.
 *
 * `bun --hot` evaluates every module again on each reload, Yjs too, and
 * keeps `globalThis`. The daemon keeps its documents there
 * (`runtime/hot.ts` of `@nightshift/daemon`), so after a reload they are of
 * the Yjs before it, and the code of the new one fails their `instanceof`
 * checks: a save does not find its flow, and Yjs refuses a new `Y.Map`
 * ("Unexpected content type"). This preload loads Yjs once per process and
 * gives that one module to every reload.
 */
import { plugin } from "bun";

type KeptYjs = { nightshiftYjs?: Record<string, unknown> };
const kept = globalThis as KeptYjs;

// Before the plugin, so this import loads the real module. A reload that
// runs this file again takes the one it has.
kept.nightshiftYjs ??= { ...(await import("yjs")) };
const yjs = kept.nightshiftYjs;

plugin({
	name: "one-yjs-per-process",
	setup(build) {
		// The ES module of Yjs, the one every import of "yjs" resolves to.
		build.onLoad({ filter: /[\\/]yjs[\\/]dist[\\/]yjs\.mjs$/ }, () => ({
			exports: yjs,
			loader: "object",
		}));
	},
});
