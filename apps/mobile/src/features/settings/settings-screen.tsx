import { PushCard } from "@/features/push";
import { Screen } from "@/shared/page";
import { AccountCard } from "./account-card";
import { NotificationsCard } from "./notifications-card";
import { ThisPhoneCard } from "./this-phone-card";

/** Who is signed in to which Host, notifications on this phone, the person's notification settings, and this phone. */
export function SettingsScreen() {
	return (
		<Screen>
			<AccountCard />
			<PushCard />
			<NotificationsCard />
			<ThisPhoneCard />
		</Screen>
	);
}
