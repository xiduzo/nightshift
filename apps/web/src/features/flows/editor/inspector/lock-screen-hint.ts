/** The hint under a Gate's "Can be answered from the lock screen" switch. */
import type { DecisionNode } from "@nightshift/flows";

/**
 * What the phone does with this Gate's notification. The buttons always
 * say Approve and Reject: Approve picks the first option and Reject the
 * second, so a lock-screen Gate needs exactly two options.
 */
export function lockScreenHint(
	node: Pick<DecisionNode, "lockScreen" | "options">,
): string {
	if (node.lockScreen !== true) {
		return "The notification opens the app on your phone. The app checks that it is you before your answer goes.";
	}
	const [first, second] = node.options;
	if (node.options.length !== 2 || !first || !second) {
		return "This works only with exactly two options. Give this Gate two options, or turn this off.";
	}
	return `Your phone shows Approve and Reject on the notification. Approve picks "${first.name}" and Reject picks "${second.name}". Use this only when a quick answer is safe.`;
}
