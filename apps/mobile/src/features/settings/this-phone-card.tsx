import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@nightshift/ui-native/components/ui/alert-dialog";
import { Button } from "@nightshift/ui-native/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Text } from "@nightshift/ui-native/components/ui/text";
import Constants from "expo-constants";
import { router } from "expo-router";

import { hostLabel, useHost, useSignedIn } from "@/features/host";
import { forgetSpaceChoice } from "@/features/spaces";

/**
 * This phone, as the Host lists it. "Remove this phone" signs it out and
 * forgets the Host here, as "Remove" in Settings on the web does.
 */
export function ThisPhoneCard() {
	const { host } = useSignedIn();
	const { forget } = useHost();
	const name = Constants.deviceName ?? "This phone";
	const where = hostLabel(host.address);

	async function remove() {
		await forgetSpaceChoice(host.address).catch(() => undefined);
		await forget();
		router.replace("/connect");
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>This phone</CardTitle>
				<CardDescription>{name}</CardDescription>
			</CardHeader>
			<CardContent className="gap-4">
				<Text variant="muted">
					Remove this phone when you no longer use it for Night Shift. It signs
					out of {where} and gets no more notifications.
				</Text>
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button variant="destructive">
							<Text>Remove this phone</Text>
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Remove this phone?</AlertDialogTitle>
							<AlertDialogDescription>
								This phone signs out and forgets {where}. To use it again, scan
								the code or type the Host address.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>
								<Text>Cancel</Text>
							</AlertDialogCancel>
							<AlertDialogAction onPress={remove}>
								<Text>Remove</Text>
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</CardContent>
		</Card>
	);
}
