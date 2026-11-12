import { useLocalSearchParams } from "expo-router";

import { SignedInOnly } from "@/features/host";
import { ReportScreen } from "@/features/runs";

export default function ReportRoute() {
	const { runId } = useLocalSearchParams<{ runId: string }>();
	return (
		<SignedInOnly>
			<ReportScreen runId={runId} />
		</SignedInOnly>
	);
}
