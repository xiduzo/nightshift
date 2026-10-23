import { useLocalSearchParams } from "expo-router";

import { FlowHealthScreen } from "@/features/dashboard";
import { SignedInOnly } from "@/features/host";

/** `/flows`: every Space. `/flows?projectId=…`: the flows of one project. */
export default function FlowsRoute() {
	const { projectId } = useLocalSearchParams<{ projectId?: string }>();
	return (
		<SignedInOnly>
			<FlowHealthScreen projectId={projectId || undefined} />
		</SignedInOnly>
	);
}
