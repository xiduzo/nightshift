import { scheduleLastRuns } from "@nightshift/client";
import type { Schedule } from "@nightshift/flows";
import { Alert, AlertDescription } from "@nightshift/ui/components/alert";
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
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CalendarClockIcon,
	CircleAlertIcon,
	PlusIcon,
	PowerOffIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type Machine,
	neededMachines,
	useSpaceMachines,
} from "@/features/devices";
import { flowQueries } from "@/features/flows";
import { runQueries } from "@/features/runs";
import { settingsQueries } from "@/features/settings";
import type { ScheduleSummary } from "@/shared/api";
import { useNow } from "@/shared/format";
import { PageHeading } from "@/shared/page";
import { scheduleMutations, scheduleQueries } from "./queries";
import { IssueLines, nameOf, ScheduleCard, whenText } from "./schedule-card";
import { ScheduleDialog } from "./schedule-dialog";
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

/** How many runs of each schedule its card shows. */
const LAST_RUNS = 10;
/** The project's newest runs, to find each schedule's last runs in. */
const RECENT_RUNS = 200;

/** The schedules that are on first, each by its next start. */
function byNextStart(schedules: readonly ScheduleSummary[]): ScheduleSummary[] {
	return [...schedules].sort(
		(a, b) =>
			Number(b.enabled) - Number(a.enabled) ||
			(a.nextAt ?? Number.POSITIVE_INFINITY) -
				(b.nextAt ?? Number.POSITIVE_INFINITY),
	);
}

/**
 * The project's schedules, one card each: what starts when, the next
 * start, and how its last runs went. Pause, edit, add, remove.
 */
export function ScheduleList({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();
	const now = useNow(30_000);
	const list = useQuery(scheduleQueries.listLive(projectId));
	const [editing, setEditing] = useState<{ schedule: Schedule | null } | null>(
		null,
	);
	const [toDelete, setToDelete] = useState<ScheduleSummary | null>(null);
	const [hookOf, setHookOf] = useState<string | null>(null);
	const schedules = list.data?.schedules ?? [];
	// Settings → Runs can turn the scheduler off; then no schedule starts.
	const settings = useQuery(settingsQueries.get());
	const schedulerOff = settings.data ? !settings.data.values.scheduler : false;
	const schedulerLock = settings.data?.fields.scheduler.locked;
	const machines = useSpaceMachines();
	const flows = useQuery(flowQueries.list(projectId));
	const runs = useQuery(runQueries.ofProject(projectId, RECENT_RUNS));
	/** The computers each schedule's run needs. Empty while they load. */
	const needs = (schedule: ScheduleSummary): Machine[] =>
		machines
			? neededMachines(
					machines,
					schedule.device,
					schedule.flow === undefined
						? { names: [], ids: [] }
						: flows.data?.find((flow) => flow.name === schedule.flow)?.devices,
				)
			: [];

	const save = useMutation(
		scheduleMutations.save({
			onSuccess: (issues) => {
				void queryClient.invalidateQueries({
					queryKey: scheduleQueries.all(),
				});
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
		save.mutate({ projectId, schedules: next }, { onSuccess: onDone });

	const upsert = (schedule: Schedule, previousId: string | null) => {
		const current = schedules.map(plain);
		const next =
			previousId === null
				? [...current, schedule]
				: current.map((s) => (s.id === previousId ? schedule : s));
		saveAll(next, () => setEditing(null));
	};

	return (
		<section
			aria-labelledby="schedules-heading"
			className="flex flex-col gap-4"
		>
			<PageHeading
				id="schedules-heading"
				title="Schedules"
				description={
					machines?.starterIsHost
						? `Flows that start on their own, at set times or when a webhook arrives. ${machines.starter.name}, the Host, starts them.`
						: "Flows that start on their own, at set times or when a webhook arrives."
				}
				actions={
					<Button
						variant="outline"
						size="sm"
						disabled={list.isLoading}
						onClick={() => setEditing({ schedule: null })}
					>
						<PlusIcon data-icon="inline-start" />
						<span className="max-sm:sr-only">New schedule</span>
					</Button>
				}
			/>
			{list.data && list.data.issues.length > 0 ? (
				<Alert>
					<CircleAlertIcon aria-hidden="true" />
					<AlertDescription>
						<IssueLines issues={list.data.issues} />
					</AlertDescription>
				</Alert>
			) : null}

			{schedulerOff && schedules.length > 0 ? (
				<Alert>
					<PowerOffIcon aria-hidden="true" />
					<AlertDescription>
						{schedulerLock ?? (
							<>
								Schedules are paused. No flow starts on its own. Turn them on in{" "}
								<Link to="/settings" className="underline underline-offset-4">
									Settings
								</Link>
								.
							</>
						)}
					</AlertDescription>
				</Alert>
			) : null}

			{list.isLoading ? (
				<div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
					<Skeleton className="h-64 w-full" />
					<Skeleton className="h-64 w-full" />
				</div>
			) : schedules.length === 0 ? (
				<Card>
					<CardContent>
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<CalendarClockIcon aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>No schedules</EmptyTitle>
								<EmptyDescription>
									{list.error
										? list.error.message
										: "Let a flow run on its own, for example every night from 22:00 to 07:00."}
								</EmptyDescription>
							</EmptyHeader>
							{list.error ? null : (
								<EmptyContent>
									<Button onClick={() => setEditing({ schedule: null })}>
										<PlusIcon data-icon="inline-start" />
										New schedule
									</Button>
								</EmptyContent>
							)}
						</Empty>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
					{byNextStart(schedules).map((schedule) => (
						<ScheduleCard
							key={schedule.id}
							projectId={projectId}
							schedule={schedule}
							description={
								flows.data?.find((flow) => flow.name === schedule.flow)
									?.description ?? null
							}
							lastRuns={scheduleLastRuns(
								runs.data ?? [],
								schedule.id,
								LAST_RUNS,
							)}
							needs={needs(schedule)}
							now={now}
							schedulerOff={schedulerOff}
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
					))}
				</div>
			)}

			<ScheduleDialog
				open={editing !== null}
				onOpenChange={(open) => {
					if (!open) setEditing(null);
				}}
				projectId={projectId}
				schedule={editing?.schedule ?? null}
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
								{toDelete ? nameOf(toDelete) : null}
							</span>
							, {toDelete ? whenText(toDelete).toLowerCase() : null}. Its past
							runs stay. To stop it for a while, pause it instead.
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
		</section>
	);
}
