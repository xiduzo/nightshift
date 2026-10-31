import { useLocalSearchParams } from "expo-router";

import { SignedInOnly } from "@/features/host";
import { SpacePicker } from "@/features/spaces";
import { StartScreen } from "@/features/start";
import { HeaderToolbar } from "@/shared/header";

/** New run. `?projectId=` chooses the project first. Starting a run is per Space: the header chooses it. */
export default function StartRoute() {
	const { projectId } = useLocalSearchParams<{ projectId?: string }>();
	return (
		<SignedInOnly>
			<HeaderToolbar
				placement="right"
				items={[{ kind: "view", key: "space", element: <SpacePicker /> }]}
			/>
			<StartScreen projectId={projectId} />
		</SignedInOnly>
	);
}
