import Constants from "expo-constants";
import { Smartphone } from "lucide-react-native";
import { Alert as NativeAlert } from "react-native";

import { hostLabel, useHost, useSignedIn } from "@/features/host";
import { removeThisPhone } from "@/features/push";
import { forgetSpaceChoice } from "@/features/spaces";
import {
	NativeButtonRow,
	NativeRow,
	NativeSection,
} from "@/shared/native-list";
import { goToConnect } from "./to-connect";

/**
 * This phone, as the Host lists it. "Remove this phone" removes it from the
 * Host's list (the Host then signs it out, as "Remove" in Settings on the
 * web does) and forgets the Host here. The phone asks first.
 */
export function ThisPhoneSection() {
	const { host } = useSignedIn();
	const { forget } = useHost();
	const name = Constants.deviceName ?? "This phone";
	const where = hostLabel(host.address);

	async function remove() {
		try {
			await removeThisPhone(host);
			await forgetSpaceChoice(host.address).catch(() => undefined);
			await forget();
			goToConnect();
		} catch (error) {
			NativeAlert.alert(
				"This phone was not removed",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	function confirmRemove() {
		NativeAlert.alert(
			"Remove this phone?",
			`This phone signs out of ${where} and gets no more notifications. To use it again, scan the code or type the Host address.`,
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Remove this phone",
					style: "destructive",
					onPress: () => void remove(),
				},
			],
		);
	}

	return (
		<NativeSection
			title="This phone"
			footer="Remove it when you no longer use it for Night Shift."
		>
			<NativeRow
				icon={{ sf: "iphone", lucide: Smartphone }}
				title={name}
				subtitle={`Signed in to ${where}`}
			/>
			<NativeButtonRow
				label="Remove this phone"
				destructive
				onPress={confirmRemove}
			/>
		</NativeSection>
	);
}
