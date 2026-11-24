import type { Schedule } from "@nightshift/flows";
import { Dialog, DialogContent } from "@nightshift/ui/components/dialog";
import { ScheduleForm } from "./schedule-form";

/**
 * Adds or edits one schedule: the flow and its inputs, when it starts (a
 * time and days, or a cron line), when it stops, the computer it runs on,
 * and the ref to start from.
 */
export function ScheduleDialog({
	open,
	onOpenChange,
	projectId,
	schedule,
	flow,
	takenIds,
	mayChange,
	saving,
	onSave,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	/** Null adds a new schedule. */
	schedule: Schedule | null;
	/** The flow a new schedule starts, until you pick another. */
	flow?: string;
	/** The ids of the other schedules. */
	takenIds: readonly string[];
	/** Whether the role of the person lets them save it. */
	mayChange: boolean;
	saving: boolean;
	onSave: (schedule: Schedule) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
				{open ? (
					<ScheduleForm
						projectId={projectId}
						schedule={schedule}
						flow={flow}
						takenIds={takenIds}
						mayChange={mayChange}
						saving={saving}
						onSave={onSave}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
