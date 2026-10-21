import { History } from "lucide-react-native";

import { EmptyState } from "@/shared/empty";
import { Screen } from "@/shared/page";

/** The runs of every Space you are in. */
export function RunsScreen() {
	return (
		<Screen>
			<EmptyState
				icon={History}
				title="No runs yet"
				description="The runs of every Space you are in show up here, newest first. Start one from the Start tab."
			/>
		</Screen>
	);
}
