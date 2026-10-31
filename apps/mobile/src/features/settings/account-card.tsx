import { Button } from "@nightshift/ui-native/components/ui/button";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useState } from "react";
import { View } from "react-native";

import { hostLabel, useHost, useSignedIn } from "@/features/host";
import { removeThisPhone } from "@/features/push";
import { InitialsAvatar } from "@/shared/avatar";
import { ListGroup, ListRow } from "@/shared/list";
import { goToConnect } from "./to-connect";
import { useNotificationSettings } from "./use-notification-settings";

/**
 * Who is signed in, at which Host, and whether it answers. Sign out: this
 * phone gets no more notifications.
 */
export function AccountCard() {
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
		} finally {
			setBusy(false);
		}
	}

	return (
		<View className="gap-3">
			<ListGroup>
				<ListRow
					leading={<InitialsAvatar name={person.name} size="md" />}
					title={person.name}
					caption={caption}
				/>
			</ListGroup>
			<Button
				size="lg"
				variant="outline"
				className="h-auto min-h-11 py-2"
				onPress={leave}
				disabled={busy}
				accessibilityHint="This phone gets no more notifications until you sign in again"
			>
				<Text>{busy ? "Signing out…" : "Sign out"}</Text>
			</Button>
		</View>
	);
}
