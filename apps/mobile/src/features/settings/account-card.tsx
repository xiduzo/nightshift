import { Button } from "@nightshift/ui-native/components/ui/button";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { Server } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { hostLabel, useHost, useSignedIn } from "@/features/host";
import { removeThisPhone } from "@/features/push";
import { InitialsAvatar } from "@/shared/avatar";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { goToConnect } from "./to-connect";

/** Who is signed in, at which Host, and Sign out. Signed out, this phone gets no more notifications. */
export function AccountCard() {
	const { person, host } = useSignedIn();
	const { signOut } = useHost();
	const [busy, setBusy] = useState(false);

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
			<SectionHead title="Account" />
			<ListGroup>
				<ListRow
					leading={<InitialsAvatar name={person.name} />}
					title={person.name}
					caption={person.email}
				/>
				<ListRow icon={Server} title="Host" caption={hostLabel(host.address)} />
			</ListGroup>
			<Button
				variant="outline"
				className="h-11"
				onPress={leave}
				disabled={busy}
				accessibilityHint="This phone gets no more notifications until you sign in again"
			>
				<Text>{busy ? "Signing out…" : "Sign out"}</Text>
			</Button>
		</View>
	);
}
