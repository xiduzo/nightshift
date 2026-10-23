import { useLocalSearchParams } from "expo-router";

import { FlowHealthScreen } from "@/features/dashboard";

/** `/flows`: every Space. `/flows?projectId=…`: the flows of one project. */
export default function FlowsRoute() {
	const { projectId } = useLocalSearchParams<{ projectId?: string }>();
	return <FlowHealthScreen projectId={projectId || undefined} />;
}
