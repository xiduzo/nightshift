import { Inbox } from "lucide-react-native";

import { EmptyState } from "@/shared/empty";
import { Screen } from "@/shared/page";

/** The Needs-you inbox: the open Gates of every Space you are in. */
export function InboxScreen() {
	return (
		<Screen>
			<EmptyState
				icon={Inbox}
				title="Nothing needs you"
				description="When a run waits for your answer at a Gate, it shows up here. This inbox holds the Gates of every Space you are in."
			/>
		</Screen>
	);
}
