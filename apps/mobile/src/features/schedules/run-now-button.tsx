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
import {
	Button,
	buttonTextVariants,
} from "@nightshift/ui-native/components/ui/button";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import {
	Text,
	TextClassContext,
} from "@nightshift/ui-native/components/ui/text";
import { Play } from "lucide-react-native";

/** Run now: asks in an Alert Dialog first. */
export function RunNowButton({
	name,
	busy,
	disabled,
	onConfirm,
}: {
	name: string;
	busy: boolean;
	disabled?: boolean;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					size="lg"
					variant="secondary"
					disabled={busy || disabled}
					className="h-auto min-h-11 py-2"
				>
					<Icon as={Play} />
					<Text>{busy ? "Starting…" : "Run now"}</Text>
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent className="w-[90%]">
				<AlertDialogHeader>
					<AlertDialogTitle>{`Run ${name} now?`}</AlertDialogTitle>
					<AlertDialogDescription>
						The run starts at once, with the inputs of this schedule. A pause
						tonight stays.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>
						<Text>Cancel</Text>
					</AlertDialogCancel>
					<AlertDialogAction onPress={onConfirm}>
						{/* The Action gives its className to the text too: the label takes the text classes of its variant only. */}
						<TextClassContext.Provider value={buttonTextVariants()}>
							<Text>Run now</Text>
						</TextClassContext.Provider>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
