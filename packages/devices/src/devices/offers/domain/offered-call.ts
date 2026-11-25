import type { AgentProfileSettings } from "@nightshift/flows";
import type { WorkCall, WorkRequest } from "../../../contract";
import { type OfferedInput, offeredInput } from "./call-input";
import {
	clampToCap,
	type DeviceOffer,
	offerFor,
	offersNothingOr,
} from "./offers";

/** The refusal of a call whose run names no starter. */
export const NO_STARTER =
	"Night Shift does not know who started this run. Start it again to run its steps.";

type Named = { name: string };

type RunNamed = { id: string; projectId: string };

/**
 * What the admission asks of one call of another Person's run: whether an
 * Offer allows it, where it works, and an offered session as this computer
 * runs it. Pure: `admitOfferedCall` holds the checks
 * that read this computer.
 */

/**
 * The snapshot calls of a Device. `deviceFor` has them only when this
 * computer has them, and its admitted path always does.
 */
export function snapshotsOf<S, C>(
	device: Named & { snapshotWorktree?: S; worktreeChanges?: C },
): { snapshotWorktree: S; worktreeChanges: C } {
	const { snapshotWorktree, worktreeChanges } = device;
	if (!snapshotWorktree || !worktreeChanges) {
		throw new Error(`${device.name} takes no snapshots of a worktree.`);
	}
	return { snapshotWorktree, worktreeChanges };
}

/**
 * The run folder call of a Device. `deviceFor` has it only when this
 * computer has it, and its admitted path always does.
 */
export function runFoldersOf<R>(device: Named & { runFolder?: R }): {
	runFolder: R;
} {
	const { runFolder } = device;
	if (!runFolder) throw new Error(`${device.name} makes no run folders.`);
	return { runFolder };
}

/** The calls that work in the project's Clone, or its run folder; a model or a tool needs none. */
export const NEEDS_CLONE: ReadonlySet<WorkCall["kind"]> = new Set([
	"worktree",
	"restoreWorktree",
	"runFolder",
	"itemBranch",
	"handOff",
	"receiveHandOff",
	"snapshotWorktree",
	"worktreeChanges",
	"session",
	"exec",
	"readFile",
]);

/** The calls that work with git: a project without a folder has none (ADR 22). */
export const GIT_CALLS: ReadonlySet<WorkCall["kind"]> = new Set([
	"worktree",
	"restoreWorktree",
	"itemBranch",
	"handOff",
	"receiveHandOff",
	"snapshotWorktree",
	"worktreeChanges",
]);

/**
 * The folder a call works in, or null for a call that names none. A new
 * kind of call says here which it is. The folder is as the Walker sent
 * it: `worksIn` says whether it is one.
 */
export function folderNamed(call: WorkCall): { cwd: unknown } | null {
	switch (call.kind) {
		case "session":
		case "exec":
		case "readFile":
			return { cwd: call.input.cwd };
		case "itemBranch":
		case "handOff":
		case "snapshotWorktree":
		case "worktreeChanges":
		case "restoreWorktree":
			return { cwd: call.cwd };
		case "capabilities":
		case "worktree":
		case "runFolder":
		case "receiveHandOff":
		case "callTool":
		case "decide":
		case "request":
		case "secret":
			return null;
	}
}

/** Whether `cwd` is the run's own folder, or a folder inside it, with no `..` on the way. */
export function worksIn(folder: string | null, cwd: unknown): boolean {
	if (folder === null || typeof cwd !== "string") return false;
	if (cwd === folder) return true;
	return (
		cwd.startsWith(`${folder}/`) &&
		!cwd.slice(folder.length).split("/").includes("..")
	);
}

/** A run's id as its start makes it: a UUID in lower case. */
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether this is the id of a run: its folders here get their names from it. */
export function isRunId(runId: string): boolean {
	return RUN_ID.test(runId);
}

/** The run's own branch: `nightshift/` and the short id, as its worktree has it. */
function runBranchOf(runId: string | null): string | null {
	return runId === null ? null : `nightshift/${runId.slice(0, 8)}`;
}

/** The run and the project a call names, beside those of its request. */
function idsNamed(call: WorkCall): {
	run?: RunNamed;
	branch?: { name: string };
	files?: { runId: string } | undefined;
	knowledge?: ({ projectId: string } | undefined)[];
} {
	switch (call.kind) {
		case "worktree":
		case "restoreWorktree":
		case "runFolder":
		case "receiveHandOff":
			return { run: call.run };
		case "handOff":
			return { branch: { name: call.runBranch } };
		case "session":
			return {
				files: call.input.artifacts,
				knowledge: [call.input.knowledge, call.input.knowledgeOnly],
			};
		case "exec":
			return {
				files: call.input.artifacts,
				knowledge: [call.input.knowledge],
			};
		// A step's own `run` is the request's: `serveWork` sets it.
		case "capabilities":
		case "itemBranch":
		case "snapshotWorktree":
		case "worktreeChanges":
		case "readFile":
		case "callTool":
		case "decide":
		case "request":
		case "secret":
			return {};
	}
}

/**
 * Why a call does not work for the run and the project of its request, or
 * null when it does: the run it adds a folder for, the run whose branch it
 * hands on, the run it keeps files of, the project whose knowledge it reads.
 */
export function foreignIds(
	call: WorkCall,
	{ runId, projectId }: Pick<WorkRequest, "runId" | "projectId">,
): string | null {
	const { run, branch, files, knowledge = [] } = idsNamed(call);
	if (run && (run.id !== runId || run.projectId !== projectId)) {
		return "This device adds a folder only for the run that asks.";
	}
	if (
		(branch && branch.name !== runBranchOf(runId)) ||
		(files && files.runId !== runId) ||
		knowledge.some((read) => read && read.projectId !== projectId)
	) {
		return "This device works only for the run that asks.";
	}
	return null;
}

/**
 * The check of one call of another Person's run, given this computer's
 * Offers in force into the run's Space: an offered session of one of
 * them, or the run's own folder work (its worktree, its item
 * branches, the Hand-off of its work to and from it, the snapshots that
 * tell what a step changed in it, the report file the run wrote there).
 * Anything
 * else is refused: a command, a tool, the decider, a session it did not
 * offer, and its capabilities (private to its owner). Null when it serves
 * the call.
 */
export function offeredCallRefusal(
	call: WorkCall,
	deviceName: string,
	offers: readonly DeviceOffer[],
): string | null {
	if (offers.length === 0) return offersNothingOr(deviceName, offers);
	const refused = `${deviceName} runs only the profiles its owner offers to this Space. ${offersNothingOr(deviceName, offers)}`;
	switch (call.kind) {
		case "worktree":
		case "restoreWorktree":
		case "runFolder":
		case "itemBranch":
		case "handOff":
		case "receiveHandOff":
		case "snapshotWorktree":
		case "worktreeChanges":
		case "readFile":
			return null;
		case "session": {
			if (!("offered" in call.input)) return refused;
			const { profile } = call.input.offered;
			return offerFor(offers, profile) !== undefined
				? null
				: offersNothingOr(deviceName, offers, profile);
		}
		default:
			return refused;
	}
}

/**
 * An offered session as this computer runs it: its profile as its owner
 * set it (harness, model, effort, CLI tools, connections), and the
 * permission mode the node asks for, else the profile's, never wider than
 * the Offer's cap. From the Walker it takes only what the step declares
 * (`OFFERED_FIELDS`).
 */
export function offeredSession(
	input: OfferedInput,
	profile: AgentProfileSettings,
	cap: DeviceOffer["permissionCap"],
) {
	return {
		...offeredInput(input),
		// Another Person's step: the engine's Secret scope rule reads it
		// (ADR 13, decision 5).
		underOffer: true as const,
		harness: profile.harness,
		model: profile.model,
		permissionMode: clampToCap(
			input.offered.permissionMode ?? profile.permissionMode,
			cap,
		),
		...(profile.effort !== undefined ? { effort: profile.effort } : {}),
		...(profile.clis.length > 0 ? { clis: profile.clis } : {}),
		...(profile.connections.length > 0
			? { connections: profile.connections }
			: {}),
	};
}
