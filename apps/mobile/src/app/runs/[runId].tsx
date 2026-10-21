import { useLocalSearchParams } from "expo-router";

import { RunScreen } from "@/features/runs";

export default function RunRoute() {
	const { runId } = useLocalSearchParams<{ runId: string }>();
	return <RunScreen runId={runId} />;
}
