import { SignedInOnly } from "@/features/host";
import { SettingsScreen } from "@/features/settings";

export default function SettingsRoute() {
	return (
		<SignedInOnly>
			<SettingsScreen />
		</SignedInOnly>
	);
}
