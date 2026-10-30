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
import { Text } from "@nightshift/ui-native/components/ui/text";
import Constants from "expo-constants";
import { Smartphone } from "lucide-react-native";
import { View } from "react-native";

import { hostLabel, useHost, useSignedIn } from "@/features/host";
import { removeThisPhone } from "@/features/push";
import { forgetSpaceChoice } from "@/features/spaces";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { goToConnect } from "./to-connect";

/**
 * This phone, as the Host lists it. "Remove this phone" removes it from the
 * Host's list (the Host then signs it out, as "Remove" in Settings on the
 * web does) and forgets the Host here.
 */
export function ThisPhoneCard() {
	const { host } = useSignedIn();
	const { forget } = useHost();
	const name = Constants.deviceName ?? "This phone";
	const where = hostLabel(host.address);

	async function remove() {
		await removeThisPhone(host);
		await forgetSpaceChoice(host.address).catch(() => undefined);
		await forget();
		goToConnect();
	}

	return (
		<View className="gap-3">
			<SectionHead
				title="This phone"
				hint="Remove it when you no longer use it for Night Shift."
			/>
			<ListGroup>
				<ListRow
					icon={Smartphone}
					title={name}
					caption={`Signed in to ${where}`}
				/>
			</ListGroup>
			<AlertDialog>
				<AlertDialogTrigger asChild>
					<Button
						size="lg"
						variant="destructive"
						className="h-auto min-h-11 py-2"
					>
						<Text>Remove this phone</Text>
					</Button>
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove this phone?</AlertDialogTitle>
						<AlertDialogDescription>
							This phone signs out of {where} and gets no more notifications. To
							use it again, scan the code or type the Host address.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							<Text>Cancel</Text>
						</AlertDialogCancel>
						<AlertDialogAction onPress={remove}>
							<Text>Remove this phone</Text>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</View>
	);
}
