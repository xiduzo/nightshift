import { Button } from "@nightshift/ui-native/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Separator } from "@nightshift/ui-native/components/ui/separator";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { hostLabel, useHost, useSignedIn } from "@/features/host";

/** Who is signed in, at which Host, and Sign out. */
export function AccountCard() {
	const { person, host } = useSignedIn();
	const { signOut } = useHost();
	const [busy, setBusy] = useState(false);

	async function leave() {
		setBusy(true);
		try {
			await signOut();
			router.replace("/connect");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{person.name}</CardTitle>
				<CardDescription>{person.email}</CardDescription>
			</CardHeader>
			<CardContent className="gap-4">
				<Separator />
				<View className="gap-1">
					<Text variant="small">Host</Text>
					<Text variant="muted" selectable>
						{hostLabel(host.address)}
					</Text>
				</View>
				<Button variant="outline" onPress={leave} disabled={busy}>
					<Text>{busy ? "Signing out…" : "Sign out"}</Text>
				</Button>
			</CardContent>
		</Card>
	);
}
