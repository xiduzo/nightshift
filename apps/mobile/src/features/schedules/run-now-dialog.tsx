import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nightshift/ui-native/components/ui/alert-dialog";
import { buttonTextVariants } from "@nightshift/ui-native/components/ui/button";
import {
	Text,
	TextClassContext,
} from "@nightshift/ui-native/components/ui/text";

/**
 * Run now asks first, in an Alert Dialog. It has no button of its own: the
 * screen opens it, from a long press or from a screen reader's action.
 */
export function RunNowDialog({
	name,
	open,
	onOpenChange,
	onConfirm,
}: {
	name: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
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
