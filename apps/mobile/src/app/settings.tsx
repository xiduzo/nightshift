import { SignedInOnly } from "@/features/access";
import { SettingsScreen } from "@/features/settings";

export default function SettingsRoute() {
	return (
		<SignedInOnly>
			<SettingsScreen />
		</SignedInOnly>
	);
}
