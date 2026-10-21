import { Screen } from "@/shared/page";
import { AccountCard } from "./account-card";
import { NotificationsCard } from "./notifications-card";
import { ThisPhoneCard } from "./this-phone-card";

/** Who is signed in to which Host, the person's notification settings, and this phone. */
export function SettingsScreen() {
	return (
		<Screen>
			<AccountCard />
			<NotificationsCard />
			<ThisPhoneCard />
		</Screen>
	);
}
