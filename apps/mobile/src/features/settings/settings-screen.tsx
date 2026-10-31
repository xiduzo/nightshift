import { PushCard } from "@/features/push";
import { Screen } from "@/shared/page";
import { AccountCard } from "./account-card";
import { AppearanceSection } from "./appearance-section";
import { NotificationSections } from "./notification-sections";
import { ThisPhoneCard } from "./this-phone-card";

/**
 * Settings: who is signed in to which Host, notifications on this phone,
 * the morning digest, what Night Shift tells you about, quiet hours, the
 * appearance, and this phone.
 */
export function SettingsScreen() {
	return (
		<Screen>
			<AccountCard />
			<PushCard />
			<NotificationSections />
			<AppearanceSection />
			<ThisPhoneCard />
		</Screen>
	);
}
