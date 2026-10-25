/**
 * Which actions a run allows now, and why not: the engine's one rule, which
 * its refusals follow too. A screen offers only what it allows, from the
 * status it shows (the live one too) and whether the computer it talks to
 * walks the run (`run.walker.thisDevice`).
 */

export {
	type RunActions,
	runActions,
	whyNot,
} from "@nightshift/engine/run-status";
