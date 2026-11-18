import { useLocalSearchParams } from "expo-router";

import { SignedInOnly } from "@/features/access";
import { ChangesScreen } from "@/features/runs";

export default function ChangesRoute() {
	const { runId } = useLocalSearchParams<{ runId: string }>();
	return (
		<SignedInOnly>
			<ChangesScreen runId={runId} />
		</SignedInOnly>
	);
}
