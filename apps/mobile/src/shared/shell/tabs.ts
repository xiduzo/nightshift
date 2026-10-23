import { waitingText } from "@nightshift/client";

export type TabBarProps = {
	/** The Gates that wait for the person: the Inbox badge. */
	waiting: number;
};

/** What a screen reader says for the Inbox tab: "Inbox, 3 Gates wait for you". */
export function inboxTabLabel(waiting: number): string {
	return waiting === 0 ? "Inbox" : `Inbox, ${waitingText(waiting)}`;
}
