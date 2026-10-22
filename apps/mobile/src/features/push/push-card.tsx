import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Button } from "@nightshift/ui-native/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { CircleAlert } from "lucide-react-native";
import { useState } from "react";
import { Linking } from "react-native";

import { askPermission, usePushPermission } from "./permission";
import { canGetPushToken } from "./registration";

/**
 * A development build without an EAS project id gets no push token, so
 * turning on notifications registers nothing. Says so, in development
 * builds only: a release build always has the id.
 */
function NoPushInThisBuild() {
	if (!__DEV__ || canGetPushToken()) return null;
	return (
		<Alert icon={CircleAlert}>
			<AlertTitle>This build cannot get notifications yet</AlertTitle>
			<AlertDescription>
				Notifications reach this phone only when the app has an Expo project.
				Run eas init, then build the app again.
			</AlertDescription>
		</Alert>
	);
}

/**
 * Asks for notifications at a moment the person understands: it says what
 * they get, and the phone asks only when they tap. When notifications are
 * off, it shows the way to the Settings app. Nothing when they are on,
 * except in a development build that cannot get notifications.
 */
export function PushCard() {
	const permission = usePushPermission();
	const [asking, setAsking] = useState(false);

	if (permission === null) return null;
	if (permission === "on") return <NoPushInThisBuild />;

	if (permission === "off") {
		return (
			<>
				<NoPushInThisBuild />
				<Card>
					<CardHeader>
						<CardTitle>Notifications are off</CardTitle>
						<CardDescription>
							To get a notification when a Gate waits for you, allow
							notifications for Night Shift in the Settings app of your phone.
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
			</>
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
		<>
			<NoPushInThisBuild />
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
		</>
	);
}
