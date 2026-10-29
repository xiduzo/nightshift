import type { StartRunInput } from "./start-run";

/**
 * What the engine asks of the Hosts this Device links to: the actions on
 * rows another Device owns. `@nightshift/devices` gives it (with more, for
 * the peers); without it, a run walked elsewhere is read-only.
 */
export type Relay = {
	/**
	 * Hands a person's action on a run walked elsewhere to its Walker,
	 * through the Host. Throws when no Host takes it: `HostUnreachableError`
	 * when the Host cannot be reached.
	 */
	command(
		command: RunCommandInput & {
			spaceId: string;
			runId: string;
			walkerId: string;
			personId: string;
		},
	): Promise<void>;
	/** Records this Device's Clone in a Space a Host keeps, through that Host. */
	addClone(input: {
		spaceId: string;
		projectId: string;
		deviceId: string;
		deviceName: string;
	}): Promise<void>;
	/**
	 * Whether this computer reaches the Host that keeps the Space now: it
	 * has an online Link to it. False for a Space this Replica keeps. A
	 * start asks it to choose the run's Walker (`start-place.ts`).
	 */
	reachable(spaceId: string): Promise<boolean>;
	/**
	 * Starts a run placed on another Device through the Host that keeps
	 * the Space: the Host walks it. Returns the run's id; its rows follow
	 * by the exchange.
	 */
	startRun(
		input: StartRunInput & { spaceId: string; deviceId: string },
	): Promise<{ runId: string }>;
};

/** A command as the engine asks for it: a person's action on a run another Device walks. */
export type RunCommandInput =
	| {
			kind: "gate.resolve";
			payload: { stepId: string; choice: string; note?: string };
	  }
	| { kind: "signal.send"; payload: { name: string } }
	| {
			kind: "run.stop";
			payload: { when?: "now" | "after-step" | "cancel-after-step" };
	  }
	/** Another Device walks the run from here on. */
	| { kind: "run.move"; payload: { to: string } };

/** What a command does. */
export type RunCommandKind = RunCommandInput["kind"];
