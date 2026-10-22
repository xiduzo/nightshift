/** The hint under a Gate's "Can be answered from the lock screen" switch. */
import type { DecisionNode } from "@nightshift/flows";

/**
 * What the phone does with this Gate's notification. The buttons say
 * Approve and Reject, and they show only for a Gate with two options.
 */
export function lockScreenHint(
	node: Pick<DecisionNode, "lockScreen" | "options">,
): string {
	if (node.lockScreen !== true) {
		return "The notification opens the app on your phone. The app checks that it is you before your answer goes.";
	}
	if (node.options.length !== 2) {
		return "This works only with exactly two options. Until then, the notification opens the app on your phone.";
	}
	return "With two options, your phone shows Approve and Reject on the notification. Approve picks the first option and Reject picks the second. Use this only when a quick answer is safe.";
}
