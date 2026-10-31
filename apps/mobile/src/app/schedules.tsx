import { useLocalSearchParams } from "expo-router";

import { SignedInOnly } from "@/features/host";
import { SchedulesScreen } from "@/features/schedules";

/** `/schedules`: the active Space. `/schedules?projectId=…`: the schedules of one project. */
export default function SchedulesRoute() {
	const { projectId } = useLocalSearchParams<{ projectId?: string }>();
	return (
		<SignedInOnly>
			<SchedulesScreen projectId={projectId || undefined} />
		</SignedInOnly>
	);
}
