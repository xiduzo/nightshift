import { useLocalSearchParams } from "expo-router";

import { StartScreen } from "@/features/start";

/** New run. `?projectId=` chooses the project first. */
export default function StartRoute() {
	const { projectId } = useLocalSearchParams<{ projectId?: string }>();
	return <StartScreen projectId={projectId} />;
}
