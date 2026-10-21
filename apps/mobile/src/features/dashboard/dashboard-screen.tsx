import { LayoutDashboard } from "lucide-react-native";

import { EmptyState } from "@/shared/empty";
import { Screen } from "@/shared/page";

/** A summary of the runs: how many finished, failed and waited. */
export function DashboardScreen() {
	return (
		<Screen>
			<EmptyState
				icon={LayoutDashboard}
				title="No numbers yet"
				description="After your first runs, you see here how many finished, failed and waited for you."
			/>
		</Screen>
	);
}
