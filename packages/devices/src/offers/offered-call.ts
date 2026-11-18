import type {
	Device,
	OfferedSessionInput,
	SessionInput,
} from "@nightshift/engine";
import type { AgentProfileSettings } from "@nightshift/flows";
import type { WorkCall } from "../contract";
import {
	clampToCap,
	type DeviceOffer,
	offerFor,
	offersNothingOr,
} from "./offers";

/**
 * What the admission asks of one call of another Person's run: whether an
 * Offer allows it, where it works, and an offered session as this computer
 * runs it. Pure: `createOfferAdmission` (`admission.ts`) holds the checks
 * that read this computer.
 */

export type SnapshotInput = Parameters<
	NonNullable<Device["snapshotWorktree"]>
>[0];
export type RestoreInput = Parameters<
	NonNullable<Device["restoreWorktree"]>
>[0];
export type ChangesInput = Parameters<
	NonNullable<Device["worktreeChanges"]>
>[0];

/**
 * The snapshot calls of a Device. `deviceFor` has them only when this
 * computer has them, and its admitted path always does.
 */
export function snapshotsOf(
	device: Device,
): Required<Pick<Device, "snapshotWorktree" | "worktreeChanges">> {
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
export function runFoldersOf(
	device: Device,
): Required<Pick<Device, "runFolder">> {
	const { runFolder } = device;
	if (!runFolder) throw new Error(`${device.name} makes no run folders.`);
	return { runFolder };
}

/**
 * The file call of a Device. `deviceFor` has it only when this computer
 * has it, and its admitted path always does.
 */
export function filesOf(device: Device): Required<Pick<Device, "readFile">> {
	const { readFile } = device;
	if (!readFile) throw new Error(`${device.name} reads no files.`);
	return { readFile };
}

/** The calls that work in the project's Clone, or its run folder; a model or a tool needs none. */
export const NEEDS_CLONE: ReadonlySet<WorkCall["kind"]> = new Set([
	"flows",
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

/** The folder a call works in, for the calls that name one. */
export function cwdOf(call: WorkCall): string | null {
	switch (call.kind) {
		case "session":
		case "exec":
		case "readFile":
			return call.input.cwd;
		case "itemBranch":
		case "handOff":
		case "snapshotWorktree":
		case "worktreeChanges":
		case "restoreWorktree":
			return call.cwd;
		default:
			return null;
	}
}

/**
 * The check of one call of another Person's run, given this computer's
 * Offers in force into the run's Space: an offered session of one of
 * them, or the run's own folder work (its flows, its worktree, its item
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
		case "flows":
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
 * the Offer's cap.
 */
export function offeredSession(
	input: Omit<OfferedSessionInput, "signal">,
	profile: AgentProfileSettings,
	cap: DeviceOffer["permissionCap"],
): Omit<SessionInput, "signal"> {
	const { offered, ...rest } = input;
	return {
		...rest,
		// Another Person's step: the engine's Secret scope rule reads it
		// (ADR 13, decision 5). Set after the spread, so no Walker can take
		// it off.
		underOffer: true,
		harness: profile.harness,
		model: profile.model,
		permissionMode: clampToCap(
			offered.permissionMode ?? profile.permissionMode,
			cap,
		),
		...(profile.effort !== undefined ? { effort: profile.effort } : {}),
		...(profile.clis.length > 0 ? { clis: profile.clis } : {}),
		...(profile.connections.length > 0
			? { connections: profile.connections }
			: {}),
	};
}
