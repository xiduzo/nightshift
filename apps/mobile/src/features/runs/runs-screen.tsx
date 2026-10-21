import { History } from "lucide-react-native";

import { EmptyState } from "@/shared/empty";
import { Screen } from "@/shared/page";

/** The runs of the Space you chose in the header. */
export function RunsScreen() {
	return (
		<Screen>
			<EmptyState
				icon={History}
				title="No runs yet"
				description="The runs of this Space show up here, newest first. Start one from the Start tab."
			/>
		</Screen>
	);
}
