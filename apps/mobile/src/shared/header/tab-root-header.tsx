import { router } from "expo-router";
import { Plus } from "lucide-react-native";

import { AvatarButton } from "./header-button";
import type { HeaderItem } from "./header-items";
import { HeaderToolbar } from "./header-toolbar";

/**
 * The header of a tab's first screen, the same on each tab: your avatar
 * on the left opens Settings, + on the right starts a run. `right` adds
 * items in front of +, such as the Space picker on Runs.
 */
export function TabRootHeader({
	name,
	right = [],
}: {
	/** The person signed in, for the avatar. */
	name: string;
	right?: readonly HeaderItem[];
}) {
	return (
		<>
			<HeaderToolbar
				placement="left"
				items={[
					{
						kind: "view",
						key: "settings",
						element: (
							<AvatarButton
								name={name}
								label="Settings"
								hint={`Signed in as ${name}`}
								href="/settings"
							/>
						),
					},
				]}
			/>
			<HeaderToolbar
				placement="right"
				items={[
					...right,
					{
						kind: "button",
						key: "start",
						label: "New run",
						sf: "plus",
						icon: Plus,
						onPress: () => router.push("/start"),
					},
				]}
			/>
		</>
	);
}
