import { Refusal } from "@nightshift/refusal";
import type { RunCommandInput } from "./command";
import type { LeaseHost } from "./leases";
import type { StartRunInput } from "./start-run";

/** What a person reads when the Host that keeps a Space cannot be reached. */
export const HOST_UNREACHABLE =
	"The computer that keeps this Space cannot be reached. Try again when it is online.";

/**
 * The Host that keeps the Space cannot be reached now: this computer has
 * no online Link to it. The person tries again later. `Relay` throws it
 * for an action on such a Space. The API answers it with its own code
 * (`HOST_UNREACHABLE`), so a screen can say so.
 */
export class HostUnreachableError extends Refusal {
	constructor() {
		super("unavailable", HOST_UNREACHABLE);
		this.name = "HostUnreachableError";
	}
}

/** What a person reads when the Host that keeps a Space cannot exchange knowledge yet. */
export const OLDER_HOST =
	"The computer that keeps this Space runs an older version of Night Shift. Update Night Shift there to share this knowledge with your other devices.";

/** What a person reads when a Host does not know a procedure, and the call has no words of its own for it. */
const OLDER_HOST_VERSION =
	"This Host runs an older version of Night Shift. Update Night Shift there.";

/**
 * The Host that keeps the Space runs an older version of Night Shift: it
 * does not know the procedures of a call, so it answers that it has none.
 * Not a failure: this computer works on its own copy and asks again later.
 * `message` is what the person reads for the call that found this out
 * (`OLDER_HOST` for knowledge).
 */
export class OlderHostError extends Refusal {
	constructor(message: string = OLDER_HOST_VERSION, options?: ErrorOptions) {
		super("unavailable", message, options);
		this.name = "OlderHostError";
	}
}

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
	/**
	 * Adds a Project to a Space a Host keeps, through that Host: the Host
	 * defines it in the Space document and copies it from GitHub. Returns
	 * the Project's id. A Project the Space has with this remote comes
	 * back, a removed one restored.
	 */
	addProject(input: {
		spaceId: string;
		name: string;
		remote: string;
	}): Promise<{ projectId: string }>;
	/**
	 * Adds a Project without a folder (ADR 22) to a Space a Host keeps,
	 * through that Host: the Host defines it in the Space document. Returns
	 * the Project's id. Each call adds another Project. A Host of a version
	 * before ADR 22 refuses it with `OlderHostError`.
	 */
	addWithoutFolder(input: {
		spaceId: string;
		name: string;
	}): Promise<{ projectId: string }>;
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
		input: StartRunInput & { spaceId: string },
	): Promise<{ runId: string }>;
	/**
	 * The leases of a Space a Host keeps, through that Host (ADR 7).
	 * Absent: this Replica reaches no Host's leases, and a run in such a
	 * Space waits for its Host.
	 */
	leases?: LeaseHost;
};
