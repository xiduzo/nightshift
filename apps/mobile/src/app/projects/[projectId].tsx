import { useLocalSearchParams } from "expo-router";

import { ProjectScreen } from "@/features/projects";

export default function ProjectRoute() {
	const { projectId } = useLocalSearchParams<{ projectId: string }>();
	return <ProjectScreen projectId={projectId} />;
}
