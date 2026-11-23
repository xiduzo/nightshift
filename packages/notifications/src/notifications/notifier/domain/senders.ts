/** Which daemon sends the notifications of a Space. */

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
