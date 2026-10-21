import { spaceRoster } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { Engine } from "@nightshift/engine";

/**
 * What the notifier reads, as ports: the run events of this Replica, the
 * open Gates of a Space, who may see a Space's runs, and which Spaces
 * this daemon sends for. The engine and auth implement them here; the
 * tests use fakes (`./testing`).
 */

/** One run event, as the notifier reads it. */
export type RunEvent = {
	spaceId: string;
	runId: string;
	stepId: string | null;
	type: string;
	seq: number;
	payload: unknown;
};

/**
 * An open Gate, by its run and step, and what a lock-screen notification
 * needs of it: the author's mark and the names of its options.
 */
export type OpenGateRef = {
	runId: string;
	stepId: string;
	/** The author marked it to be answered from the lock screen. Default: false. */
	lockScreen?: boolean;
	/** The names of its options, in the author's order. */
	choices?: string[];
};

export type RunEventSource = {
	/** Calls `listener` with the run events that land from now on. Returns the unsubscribe. */
	subscribe(listener: (events: readonly RunEvent[]) => void): () => void;
	/** The open Gates of the Space's runs. */
	openGates(spaceId: string): Promise<OpenGateRef[]>;
};

/** The engine's run events and open Gates. */
export function engineRunEvents(
	engine: Pick<Engine, "onRunEvents" | "space">,
): RunEventSource {
	return {
		subscribe: (listener) => engine.onRunEvents(listener),
		async openGates(spaceId) {
			const gates = await engine.space(spaceId).listGates();
			return gates.map((g) => ({
				runId: g.runId,
				stepId: g.stepId,
				lockScreen: g.lockScreen,
				choices: g.choices.map((choice) => choice.name),
			}));
		},
	};
}

/**
 * Who may see the runs of a Space: its Members, in every role. A viewer
 * sees a Gate too, without its options.
 */
export function spaceAudience(
	db: Database,
): (spaceId: string) => Promise<string[]> {
	return async (spaceId) =>
		(await spaceRoster(db, spaceId)).map((member) => member.id);
}

/** What decides which Spaces this daemon sends notifications for. */
export type SenderFacts = {
	/** This computer is a Host ("Be a Host" is on). */
	isHost(): boolean;
	/** A Host keeps the Space, not this Replica. */
	hostedElsewhere(spaceId: string): Promise<boolean>;
	/** The personal Space of the Person who owns this computer. */
	ownPersonalSpaceId(): Promise<string | null>;
};

/**
 * One sender per Space, so two daemons never send the same notification.
 * A Host sends for the Spaces it keeps. A Device that is not a Host sends
 * only for its own personal Space: its Host sends for the rest. A Space
 * another Host keeps is never this daemon's. The open pages still update
 * for every Space (the in-app stream), without a notification.
 */
export function oneSenderPerSpace(
	facts: SenderFacts,
): (spaceId: string) => Promise<boolean> {
	return async (spaceId) => {
		if (await facts.hostedElsewhere(spaceId)) return false;
		if (facts.isHost()) return true;
		return (await facts.ownPersonalSpaceId()) === spaceId;
	};
}
