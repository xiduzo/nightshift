import { useLocalSearchParams } from "expo-router";

import { SignedInOnly } from "@/features/host";
import { LearningsScreen } from "@/features/learnings";

/** `/learnings`: every project. `/learnings?projectId=…`: one project. */
export default function LearningsRoute() {
	const { projectId } = useLocalSearchParams<{ projectId?: string }>();
	return (
		<SignedInOnly>
			<LearningsScreen projectId={projectId || undefined} />
		</SignedInOnly>
	);
}
