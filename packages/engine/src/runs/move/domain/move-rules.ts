import { FLOW_VERSION } from "@nightshift/flows";
import type { OwnDevice } from "../../../contract";
import { RunRefusal } from "../../../run-status";

/**
 * The rules of a move of a run's walk to another of the Person's Devices,
 * past the status rule (`run-status/` has it, which the screens read too).
 * Each takes the shape of the run it reads: the run's row and the fold of
 * its log fit them.
 */

/** What a person reads for a move to the computer that walks the run already. */
export const WALKS_HERE = "This run already runs on this computer.";

/** What a person reads for a move to a Device that is not one of theirs. */
export const NOT_YOUR_DEVICE = "That device is not one of yours.";

/** What a person reads for a move or its targets without a Person. */
export const SIGN_IN = "Sign in to act on this run.";

/** Why a run that moved here cannot arrive yet: its old Walker kept no Checkpoint of it. */
export const NO_CHECKPOINT = "The archive has no checkpoint of the run.";

/** A move or its targets need a Person: Night Shift moves no run on its own. */
export function signedOut(): RunRefusal {
	return new RunRefusal("signed-out", SIGN_IN);
}

/** Throws when the move goes to this computer: as the Walker of its runs (`walkerId`) or as a Device. */
export function refuseMoveHere(
	to: string,
	here: { walkerId: string; deviceId: string },
): void {
	if (to === here.walkerId || to === here.deviceId) {
		throw new RunRefusal("walks-here", WALKS_HERE);
	}
}

/** The move to a Device the planner does not count as one of the Person's own. */
export function notYourDevice(): RunRefusal {
	return new RunRefusal("not-your-device", NOT_YOUR_DEVICE);
}

/**
 * The newest flow format of a run's flows, as its row keeps them: the
 * format a Walker must read to walk it. A snapshot that does not read
 * counts as this build's format.
 */
export function snapshotVersion(run: {
	flow: string;
	bodyFlows: string;
}): number {
	try {
		const flow = JSON.parse(run.flow) as { version?: unknown };
		const called = Object.values(
			JSON.parse(run.bodyFlows) as Record<string, { version?: unknown }>,
		);
		const versions = [flow, ...called].map((f) =>
			typeof f?.version === "number" ? f.version : FLOW_VERSION,
		);
		return Math.max(...versions);
	} catch {
		return FLOW_VERSION;
	}
}

/**
 * Whether the target can walk the run: it reads the run's flows, and it
 * walks a test run only when it says it walks test runs (ADR 27). Else it
 * would run every node of a test run for real.
 */
export function walksThere(
	target: { flowVersion: number; testRuns: boolean },
	run: { flowVersion: number; test: boolean },
): boolean {
	return (
		target.flowVersion >= run.flowVersion && (!run.test || target.testRuns)
	);
}

/**
 * The Devices of the Person a run can move to: their own (another
 * Person's Device takes steps through its Offers, never a walk), online,
 * and not the run's Walker. This computer is no target of a run it walks.
 */
export function movable(
	devices: readonly OwnDevice[],
	run: { walkerId: string },
	walkedHere: boolean,
): OwnDevice[] {
	return devices.filter(
		(d) =>
			d.offers === undefined &&
			d.online &&
			d.deviceId !== run.walkerId &&
			!(walkedHere && d.thisDevice),
	);
}
