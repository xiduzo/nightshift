import { CircleUserRound } from "lucide-react-native";
import { useState } from "react";
import { Alert as NativeAlert } from "react-native";

import { hostLabel, useHost, useSignedIn } from "@/features/host";
import { removeThisPhone } from "@/features/push";
import {
	NativeButtonRow,
	NativeRow,
	NativeSection,
} from "@/shared/native-list";
import { goToConnect } from "./to-connect";
import { useNotificationSettings } from "./use-notification-settings";

/**
 * Who is signed in, at which Host, and whether it answers. Sign out: this
 * phone gets no more notifications. The phone asks first.
 */
export function AccountSection() {
	const { person, host } = useSignedIn();
	const { signOut } = useHost();
	const [busy, setBusy] = useState(false);
	// The settings read is the Host's answer: it answered, or it did not.
	const reach = useNotificationSettings();
	const where = `Signed in to ${hostLabel(host.address)}`;
	const caption = reach.isError
		? `${where} · not reachable`
		: reach.isSuccess
			? `${where} · online`
			: where;

	async function leave() {
		setBusy(true);
		try {
			await removeThisPhone(host);
			await signOut();
			goToConnect();
		} catch (error) {
			NativeAlert.alert(
				"You are still signed in",
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			setBusy(false);
		}
	}

	function confirmSignOut() {
		NativeAlert.alert(
			"Sign out?",
			"This phone gets no more notifications until you sign in again.",
			[
				{ text: "Cancel", style: "cancel" },
				{ text: "Sign out", style: "destructive", onPress: () => void leave() },
			],
		);
	}

	return (
		<NativeSection>
			<NativeRow
				icon={{ sf: "person.crop.circle.fill", lucide: CircleUserRound }}
				title={person.name}
				subtitle={caption}
			/>
			<NativeButtonRow
				label={busy ? "Signing out…" : "Sign out"}
				destructive
				disabled={busy}
				onPress={confirmSignOut}
			/>
		</NativeSection>
	);
}
