import { PushSection } from "@/features/push";
import { NativeList } from "@/shared/native-list";
import { AccountSection } from "./account-section";
import { AppearanceSection } from "./appearance-section";
import { NotificationSections } from "./notification-sections";
import { ThisPhoneSection } from "./this-phone-section";

/**
 * Settings, as a native grouped list (the Settings app of the phone): who
 * is signed in to which Host, notifications on this phone, what Night
 * Shift tells you about, quiet hours, the appearance, and this phone.
 */
export function SettingsScreen() {
	return (
		<NativeList>
			<AccountSection />
			<PushSection />
			<NotificationSections />
			<AppearanceSection />
			<ThisPhoneSection />
		</NativeList>
	);
}
