import { Button } from "@nightshift/ui-native/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { router } from "expo-router";
import { BellOff } from "lucide-react-native";

import { useConnection } from "@/features/connection";
import { EmptyState } from "@/shared/empty";
import { Screen } from "@/shared/page";

/** This phone's Host and, later, its notification settings. */
export function SettingsScreen() {
	const { connection, signOut } = useConnection();

	async function disconnect() {
		await signOut();
		router.replace("/connect");
	}

	return (
		<Screen>
			{connection.status === "connected" ? (
				<Card>
					<CardHeader>
						<CardTitle>Host</CardTitle>
						<CardDescription>{connection.host.address}</CardDescription>
					</CardHeader>
					<CardContent className="gap-4">
						<Text variant="muted">
							Signed in as {connection.person.name} ({connection.person.email})
						</Text>
						<Button variant="outline" onPress={disconnect}>
							<Text>Sign out</Text>
						</Button>
					</CardContent>
				</Card>
			) : null}
			<EmptyState
				icon={BellOff}
				title="No notifications on this phone"
				description="When notifications are on, this phone tells you when a Gate waits for you or a run ends."
			/>
		</Screen>
	);
}
