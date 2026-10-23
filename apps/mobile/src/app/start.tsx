import { useLocalSearchParams } from "expo-router";

import { SignedInOnly } from "@/features/host";
import { StartScreen } from "@/features/start";

/** New run. `?projectId=` chooses the project first. */
export default function StartRoute() {
	const { projectId } = useLocalSearchParams<{ projectId?: string }>();
	return (
		<SignedInOnly>
			<StartScreen projectId={projectId} />
		</SignedInOnly>
	);
}
