import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
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
import { Button } from "@nightshift/ui/components/button";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, LogOutIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { leaveMutation } from "./queries";

/**
 * "Leave <Host>" for this computer's home Host (`nightshift leave`): it
 * asks first, and says that the Host keeps everything and this computer
 * keeps a Personal of its own.
 */
export function LeaveHostButton({ hostName }: { hostName: string }) {
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();
	const leave = useMutation({
		...leaveMutation(),
		onSuccess: (result) => {
			// Personal is this computer's own now: every list reads again.
			void queryClient.invalidateQueries();
			setOpen(false);
			if (result.told) {
				toast.success(`You left ${result.host.name}`);
			} else {
				toast.warning(
					`You left ${result.host.name}. It did not answer, so remove this computer on its Devices page too.`,
				);
			}
			if (result.waiting !== null) {
				toast.info(
					"Your Personal on this computer is ready when its runs are done.",
				);
			}
			const unpinned = result.split?.unpinned ?? 0;
			if (unpinned > 0) {
				toast.info(
					unpinned === 1
						? "1 schedule named another device. It is paused here. Turn it on to run it on this computer."
						: `${unpinned} schedules named another device. They are paused here. Turn them on to run them on this computer.`,
				);
			}
		},
	});
	return (
		<>
			<Button variant="outline" size="sm" onClick={() => setOpen(true)}>
				<LogOutIcon data-icon="inline-start" />
				Leave {hostName}
			</Button>
			<AlertDialog open={open} onOpenChange={setOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Leave {hostName}?</AlertDialogTitle>
						<AlertDialogDescription>
							This computer stops syncing with {hostName}. {hostName} keeps all
							your projects, flows and runs. This computer keeps its own
							Personal with the projects here, their flows and schedules, and
							its runs. Night Shift keeps a copy of your data from before.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{leave.error ? (
						<Alert variant="destructive">
							<CircleAlertIcon />
							<AlertTitle>This computer did not leave</AlertTitle>
							<AlertDescription>{leave.error.message}</AlertDescription>
						</Alert>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={leave.isPending}
							onClick={() => leave.mutate(undefined)}
						>
							{leave.isPending ? <Spinner data-icon="inline-start" /> : null}
							Leave {hostName}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
