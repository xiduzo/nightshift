import { Button } from "@nightshift/ui-native/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useState } from "react";
import { Linking } from "react-native";

import { askPermission, usePushPermission } from "./permission";

/**
 * Asks for notifications at a moment the person understands: it says what
 * they get, and the phone asks only when they tap. When notifications are
 * off, it shows the way to the Settings app. Nothing when they are on.
 */
export function PushCard() {
	const permission = usePushPermission();
	const [asking, setAsking] = useState(false);

	if (permission === null || permission === "on") return null;

	if (permission === "off") {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Notifications are off</CardTitle>
					<CardDescription>
						To get a notification when a Gate waits for you, allow notifications
						for Night Shift in the Settings app of your phone.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button
						variant="outline"
						onPress={() => void Linking.openSettings()}
						accessibilityHint="Opens the Settings app of your phone"
					>
						<Text>Open Settings</Text>
					</Button>
				</CardContent>
			</Card>
		);
	}

	async function turnOn() {
		setAsking(true);
		try {
			await askPermission();
		} catch {
			// The phone did not ask: the card stays, the person can tap again.
		} finally {
			setAsking(false);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Get a notification when a Gate waits for you</CardTitle>
				<CardDescription>
					Your phone tells you when a run needs your answer, also when Night
					Shift is closed. Some Gates you can answer from the notification.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Button onPress={() => void turnOn()} disabled={asking}>
					<Text>Turn on notifications</Text>
				</Button>
			</CardContent>
		</Card>
	);
}
