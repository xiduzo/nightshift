import { useLocalSearchParams } from "expo-router";

import { SignedInOnly } from "@/features/host";
import { ProjectScreen } from "@/features/projects";

export default function ProjectRoute() {
	const { projectId } = useLocalSearchParams<{ projectId: string }>();
	return (
		<SignedInOnly>
			<ProjectScreen projectId={projectId} />
		</SignedInOnly>
	);
}
