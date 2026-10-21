import { Play } from "lucide-react-native";

import { EmptyState } from "@/shared/empty";
import { Screen } from "@/shared/page";

/** Start a flow of the Space you chose in the header, with its inputs. */
export function StartScreen() {
	return (
		<Screen>
			<EmptyState
				icon={Play}
				title="Start a flow"
				description="Choose a flow and fill in its inputs. Your Host runs it, and you follow it here."
			/>
		</Screen>
	);
}
