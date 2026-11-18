import { Bell, BellOff } from "lucide-react-native";
import { useState } from "react";
import { Linking } from "react-native";

import {
	NativeButtonRow,
	NativeRow,
	NativeSection,
	NativeTextRow,
} from "@/shared/native-list";
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
		<NativeSection>
			<NativeTextRow
				text="This build cannot get notifications yet"
				note="Notifications reach this phone only when the app has an Expo project. Run eas init, then build the app again."
			/>
		</NativeSection>
	);
}

/**
 * The PushCard of a native grouped list (Settings): it asks for
 * notifications when the person taps, or shows the way to the Settings
 * app when they are off. Nothing when they are on, except in a
 * development build that cannot get notifications.
 */
export function PushSection() {
	const permission = usePushPermission();
	const [asking, setAsking] = useState(false);

	if (permission === null) return null;
	if (permission === "on") return <NoPushInThisBuild />;

	if (permission === "off") {
		return (
			<>
				<NoPushInThisBuild />
				<NativeSection
					title="Notifications"
					footer="Allow them for Night Shift in the Settings app of your phone."
				>
					<NativeRow
						icon={{ sf: "bell.slash", lucide: BellOff }}
						title="Notifications are off"
					/>
					<NativeButtonRow
						label="Open Settings"
						onPress={() => void Linking.openSettings()}
					/>
				</NativeSection>
			</>
		);
	}

	async function turnOn() {
		setAsking(true);
		try {
			await askPermission();
		} catch {
			// The phone did not ask: the row stays, the person can tap again.
		} finally {
			setAsking(false);
		}
	}

	return (
		<>
			<NoPushInThisBuild />
			<NativeSection
				title="Notifications"
				footer="Your phone tells you, also when Night Shift is closed. You can answer some Gates from the notification."
			>
				<NativeRow
					icon={{ sf: "bell", lucide: Bell }}
					title="Get a notification when a Gate waits for you"
				/>
				<NativeButtonRow
					label="Turn on notifications"
					disabled={asking}
					onPress={() => void turnOn()}
				/>
			</NativeSection>
		</>
	);
}
