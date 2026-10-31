import { useLocalSearchParams } from "expo-router";

import { SignedInOnly } from "@/features/host";
import { ScheduleScreen } from "@/features/schedules";

/** `/schedule?projectId=…&scheduleId=…`: one schedule, with Pause tonight and Run now. */
export default function ScheduleRoute() {
	const { projectId, scheduleId } = useLocalSearchParams<{
		projectId: string;
		scheduleId: string;
	}>();
	return (
		<SignedInOnly>
			<ScheduleScreen projectId={projectId} scheduleId={scheduleId} />
		</SignedInOnly>
	);
}
