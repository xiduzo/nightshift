import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nightshift/ui/components/alert-dialog";

/** Asks before you leave the editor with changes that are not saved. */
export function LeaveDialog({
	blocked,
	name,
	onStay,
	onLeave,
}: {
	/** True while a navigation waits for the answer. */
	blocked: boolean;
	name: string;
	onStay: () => void;
	onLeave: () => void;
}) {
	return (
		<AlertDialog
			open={blocked}
			onOpenChange={(open) => {
				if (!open && blocked) onStay();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Leave without saving?</AlertDialogTitle>
					<AlertDialogDescription>
						The changes to <span className="font-mono">{name}</span> are not
						saved. They are lost when you leave.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Stay</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						onClick={() => blocked && onLeave()}
					>
						Leave
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
