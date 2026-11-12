import {
	readerTimeZone,
	scheduleLastRuns,
	scheduleName,
	scheduleWhen,
} from "@nightshift/client";
import type { Schedule } from "@nightshift/flows";
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
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { ItemGroup } from "@nightshift/ui/components/item";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@nightshift/ui/components/sheet";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
	type Machine,
	neededMachines,
	useSpaceMachines,
} from "@/features/devices";
import { runQueries } from "@/features/runs/flows-port";
import type { ScheduleSummary } from "@/shared/api";
import { useNow } from "@/shared/format";
import { flowQueries } from "../queries";
import { scheduleMutations, scheduleQueries } from "./queries";
import { ScheduleDialog } from "./schedule-dialog";
import { ScheduleItem } from "./schedule-item";
import { WebhookDialog } from "./webhook-deliveries";

/** The schedule as the file holds it, without what the engine derived. */
function plain(summary: ScheduleSummary): Schedule {
	const {
		nextAt: _next,
		last: _last,
		deliveries: _deliveries,
		issues: _issues,
		...schedule
	} = summary;
	return schedule;
}

/** How many runs of each schedule its item shows. */
const LAST_RUNS = 10;
/** The project's newest runs, to find each schedule's last runs in. */
const RECENT_RUNS = 200;

/** The schedules of a project, as the Flows page shows and changes them. */
export type ScheduleBoard = {
	/** Every schedule of the project. Empty while they load. */
	schedules: ScheduleSummary[];
	/** An item for each of `schedules`. `describe` says what one does, where the flow around it does not. */
	items: (
		schedules: readonly ScheduleSummary[],
		describe?: (schedule: ScheduleSummary) => ReactNode,
	) => ReactNode;
	/** Opens the dialog for a new schedule of `flow`. */
	add: (flow?: string) => void;
	/** The dialogs to add, edit and remove one, and a webhook's address. */
	dialogs: ReactNode;
};

/**
 * Reads and changes the project's schedules. All of them save as one
 * list, so pausing one also sends the others as they are. `showRuns`
 * reads the runs the items need, only while one shows.
 */
export function useScheduleBoard(
	projectId: string,
	showRuns: boolean,
): ScheduleBoard {
	const now = useNow(30_000);
	const list = useQuery(scheduleQueries.listLive(projectId));
	const [editing, setEditing] = useState<{
		schedule: Schedule | null;
		flow?: string;
	} | null>(null);
	const [toDelete, setToDelete] = useState<ScheduleSummary | null>(null);
	const [hookOf, setHookOf] = useState<string | null>(null);
	const schedules = list.data?.schedules ?? [];
	const machines = useSpaceMachines();
	const flows = useQuery(flowQueries.list(projectId));
	const runs = useQuery({
		...runQueries.ofProject(projectId, RECENT_RUNS),
		enabled: showRuns,
	});
	/** The computers each schedule's run needs. Empty while they load. */
	const needs = (schedule: ScheduleSummary): Machine[] =>
		machines
			? neededMachines(
					machines,
					true,
					schedule.flow === undefined
						? { ids: [] }
						: flows.data?.find((flow) => flow.name === schedule.flow)?.devices,
				)
			: [];

	const save = useMutation(
		scheduleMutations.save({
			onSuccess: (issues) => {
				const errors = issues.filter((issue) => issue.severity === "error");
				if (errors.length > 0) {
					toast.warning(
						`Saved, with ${errors.length === 1 ? "a problem" : `${errors.length} problems`}: ${errors[0]?.message}`,
					);
				}
			},
			onError: (error) => toast.error(`Could not save: ${error.message}`),
		}),
	);

	const saveAll = (next: Schedule[], onDone?: () => void) =>
		save.mutate(
			// A schedule's times are on the clock of the person who saves it.
			{ projectId, schedules: next, timeZone: readerTimeZone() },
			{ onSuccess: onDone },
		);

	const upsert = (schedule: Schedule, previousId: string | null) => {
		const current = schedules.map(plain);
		const next =
			previousId === null
				? [...current, schedule]
				: current.map((s) => (s.id === previousId ? schedule : s));
		saveAll(next, () => setEditing(null));
	};

	const items: ScheduleBoard["items"] = (shown, describe) =>
		shown.map((schedule) => (
			<ScheduleItem
				key={schedule.id}
				schedule={schedule}
				description={describe?.(schedule)}
				lastRuns={scheduleLastRuns(runs.data ?? [], schedule.id, LAST_RUNS)}
				needs={needs(schedule)}
				now={now}
				busy={save.isPending}
				onToggle={(enabled) =>
					saveAll(
						schedules.map((s) =>
							s.id === schedule.id ? { ...plain(s), enabled } : plain(s),
						),
					)
				}
				onEdit={() => setEditing({ schedule: plain(schedule) })}
				onDelete={() => setToDelete(schedule)}
				onWebhook={() => setHookOf(schedule.id)}
			/>
		));

	const dialogs = (
		<>
			<ScheduleDialog
				open={editing !== null}
				onOpenChange={(open) => {
					if (!open) setEditing(null);
				}}
				projectId={projectId}
				schedule={editing?.schedule ?? null}
				flow={editing?.flow}
				takenIds={schedules
					.map((s) => s.id)
					.filter((id) => id !== editing?.schedule?.id)}
				saving={save.isPending}
				onSave={(schedule) => upsert(schedule, editing?.schedule?.id ?? null)}
			/>

			<WebhookDialog
				open={hookOf !== null}
				onOpenChange={(open) => {
					if (!open) setHookOf(null);
				}}
				projectId={projectId}
				schedule={schedules.find((s) => s.id === hookOf) ?? null}
				device={machines?.starter.name}
			/>

			<AlertDialog
				open={toDelete !== null}
				onOpenChange={(open) => {
					if (!open) setToDelete(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove this schedule?</AlertDialogTitle>
						<AlertDialogDescription>
							<span className="font-mono">
								{toDelete ? scheduleName(toDelete) : null}
							</span>
							, {toDelete ? scheduleWhen(toDelete).toLowerCase() : null}. Its
							past runs stay. To stop it for a while, pause it instead.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={save.isPending}
							onClick={() => {
								if (!toDelete) return;
								saveAll(
									schedules.filter((s) => s.id !== toDelete.id).map(plain),
									() => setToDelete(null),
								);
							}}
						>
							{save.isPending ? <Spinner data-icon="inline-start" /> : null}
							{save.isPending ? "Removing…" : "Remove schedule"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);

	return {
		schedules,
		items,
		add: (flow) => setEditing({ schedule: null, flow }),
		dialogs,
	};
}

/**
 * The schedules of one flow in a side panel: what starts it, and the
 * webhooks that wake its waiting runs. Add one at the bottom.
 */
export function FlowSchedulesSheet({
	flowName,
	open,
	onOpenChange,
	schedules,
	board,
}: {
	flowName: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	schedules: readonly ScheduleSummary[];
	board: ScheduleBoard;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="data-[side=right]:sm:max-w-xl">
				<SheetHeader className="border-b">
					<SheetTitle className="font-mono">{flowName}</SheetTitle>
					<SheetDescription>
						What starts this flow, and the webhooks that wake its waiting runs.
					</SheetDescription>
				</SheetHeader>
				<div className="flex flex-1 flex-col overflow-y-auto px-4">
					{schedules.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyTitle>No schedules</EmptyTitle>
								<EmptyDescription>
									You start this flow by hand. Add a schedule to run it at set
									times or when a webhook arrives.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<ItemGroup className="gap-3">{board.items(schedules)}</ItemGroup>
					)}
				</div>
				<SheetFooter className="border-t">
					<Button onClick={() => board.add(flowName)}>
						<PlusIcon data-icon="inline-start" />
						Add schedule
					</Button>
				</SheetFooter>
				{/* Inside the panel, so its dialogs open on top of it. */}
				{open ? board.dialogs : null}
			</SheetContent>
		</Sheet>
	);
}
