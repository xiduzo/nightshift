import { describeCron, type Schedule } from "@nightshift/flows";
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
import { Checkbox } from "@nightshift/ui/components/checkbox";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CalendarClockIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { RunStatusBadge } from "@/components/run-status-badge";
import { useNow } from "@/hooks/use-now";
import type {
	ScheduleIssue,
	ScheduleResult,
	ScheduleSummary,
} from "@/lib/api-types";
import {
	dayWord,
	formatDateTime,
	formatDayTime,
	formatTime,
	formatWaited,
} from "@/lib/format";
import { orpc } from "@/utils/orpc";

import { ScheduleDialog } from "./schedule-dialog";

/** The schedule as the file holds it, without what the engine derived. */
function plain(summary: ScheduleSummary): Schedule {
	const { nextAt: _next, last: _last, issues: _issues, ...schedule } = summary;
	return schedule;
}

/**
 * The project's schedules, `.nightshift/schedules.json`: what starts when,
 * the next start, and how the last start went. Pause, edit, add, remove.
 */
export function ScheduleList({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();
	const list = useQuery({
		...orpc.schedules.list.queryOptions({ input: { projectId } }),
		// The next start moves on and a schedule may have fired.
		refetchInterval: 30_000,
		meta: { quietRefetchErrors: true },
	});
	const [editing, setEditing] = useState<{ schedule: Schedule | null } | null>(
		null,
	);
	const [toDelete, setToDelete] = useState<ScheduleSummary | null>(null);
	const schedules = list.data?.schedules ?? [];

	// A schedule that fired started a run: the run lists should show it.
	const fired = schedules
		.map((s) => (s.last?.kind === "fired" ? s.last.runId : ""))
		.join(",");
	const seenFired = useRef<string | null>(null);
	useEffect(() => {
		if (!list.data) return;
		if (seenFired.current !== null && seenFired.current !== fired) {
			void queryClient.invalidateQueries({ queryKey: orpc.runs.key() });
		}
		seenFired.current = fired;
	}, [fired, list.data, queryClient]);

	const save = useMutation(
		orpc.schedules.save.mutationOptions({
			onSuccess: (issues) => {
				void queryClient.invalidateQueries({
					queryKey: orpc.schedules.key(),
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
			className="flex flex-col gap-3"
		>
			<div className="flex items-center gap-2">
				<h2 id="schedules-heading" className="font-medium text-sm">
					Schedules
				</h2>
				<Button
					variant="outline"
					size="xs"
					className="ml-auto"
					disabled={list.isLoading}
					onClick={() => setEditing({ schedule: null })}
				>
					<PlusIcon data-icon="inline-start" />
					New schedule
				</Button>
			</div>

			{list.data && list.data.issues.length > 0 ? (
				<IssueLines issues={list.data.issues} />
			) : null}

			{list.isLoading ? (
				<Skeleton className="h-14 w-full" />
			) : schedules.length === 0 ? (
				<Empty className="border p-6 md:p-6">
					<EmptyHeader>
						<EmptyTitle>No schedules</EmptyTitle>
						<EmptyDescription>
							{list.error
								? list.error.message
								: "Start a flow without a person, for example every night at 22:00 with a stop time of 07:00."}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<ul className="flex flex-col divide-y border">
					{schedules.map((schedule) => (
						<ScheduleRow
							key={schedule.id}
							schedule={schedule}
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
						/>
					))}
				</ul>
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
							<span className="font-mono">{toDelete?.flow}</span>,{" "}
							{toDelete ? describeCron(toDelete.cron) : null}. Runs it started
							stay. To keep it but start nothing, pause it instead.
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
							{save.isPending ? "Removing…" : "Remove schedule"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}

function ScheduleRow({
	schedule,
	busy,
	onToggle,
	onEdit,
	onDelete,
}: {
	schedule: ScheduleSummary;
	busy: boolean;
	onToggle: (enabled: boolean) => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const now = useNow(30_000);
	const toggleId = `schedule-${schedule.id}-on`;
	const errors = schedule.issues.filter((issue) => issue.severity === "error");
	return (
		<li className="flex items-start gap-3 px-3 py-2">
			<CalendarClockIcon
				className="mt-0.5 size-4 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
					<span className="truncate font-medium font-mono text-sm">
						{schedule.flow}
					</span>
					<span className="text-xs">
						{describeCron(schedule.cron)}
						{schedule.stopAt ? `, stops ${schedule.stopAt}` : ""}
					</span>
				</div>
				<InputsLine inputs={schedule.inputs} baseRef={schedule.baseRef} />
				<p className="text-muted-foreground text-xs">
					{!schedule.enabled ? (
						"Paused"
					) : schedule.nextAt === null ? (
						"No next start"
					) : schedule.nextAt <= now ? (
						"Starts now"
					) : (
						<>
							Next{" "}
							<time
								dateTime={new Date(schedule.nextAt).toISOString()}
								title={formatDateTime(schedule.nextAt)}
								className="text-foreground"
							>
								{dayWord(schedule.nextAt, now)},{" "}
								{formatDayTime(schedule.nextAt)}
							</time>{" "}
							(in {formatWaited(schedule.nextAt - now)})
						</>
					)}
				</p>
				{schedule.last ? <LastResult result={schedule.last} /> : null}
				{errors.length > 0 ? <IssueLines issues={errors} /> : null}
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<div className="mr-1 flex items-center gap-1.5">
					<Checkbox
						id={toggleId}
						checked={schedule.enabled}
						disabled={busy}
						onCheckedChange={(checked) => onToggle(checked === true)}
					/>
					<label htmlFor={toggleId} className="text-xs">
						On
					</label>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Edit the schedule of ${schedule.flow}`}
					title="Edit schedule"
					onClick={onEdit}
				>
					<PencilIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Remove the schedule of ${schedule.flow}`}
					title="Remove schedule"
					onClick={onDelete}
				>
					<Trash2Icon />
				</Button>
			</div>
		</li>
	);
}

function InputsLine({
	inputs,
	baseRef,
}: {
	inputs: ScheduleSummary["inputs"];
	baseRef: string | undefined;
}) {
	const parts = Object.entries(inputs).map(
		([name, value]) =>
			`${name}=${typeof value === "string" ? value : JSON.stringify(value)}`,
	);
	if (parts.length === 0 && !baseRef) return null;
	return (
		<p className="truncate font-mono text-[11px] text-muted-foreground">
			{parts.join(" ")}
			{baseRef ? `${parts.length > 0 ? " · " : ""}from ${baseRef}` : ""}
		</p>
	);
}

function LastResult({ result }: { result: ScheduleResult }) {
	const when = (
		<time
			dateTime={new Date(result.at).toISOString()}
			title={formatDateTime(result.at)}
		>
			{formatDayTime(result.at)}
		</time>
	);
	if (result.kind === "fired") {
		return (
			<p className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground text-xs">
				<span>Last {when}:</span>
				<Link
					to="/runs/$runId"
					params={{ runId: result.runId }}
					className="flex items-center gap-1.5 underline-offset-2 outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
				>
					{result.runStatus ? (
						<RunStatusBadge status={result.runStatus} />
					) : (
						"the run"
					)}
				</Link>
			</p>
		);
	}
	if (result.kind === "failed") {
		return (
			<p className="text-destructive text-xs">
				Last {when}: did not start. {result.error}
			</p>
		);
	}
	return (
		<p className="text-muted-foreground text-xs">
			Skipped {formatTime(result.at)}: {result.reason}
			{result.runId ? (
				<>
					{" "}
					<Link
						to="/runs/$runId"
						params={{ runId: result.runId }}
						className="underline underline-offset-2"
					>
						Open that run
					</Link>
				</>
			) : null}
		</p>
	);
}

function IssueLines({ issues }: { issues: readonly ScheduleIssue[] }) {
	return (
		<ul className="flex flex-col gap-0.5">
			{issues.map((issue) => (
				<li
					key={`${issue.scheduleId ?? ""}:${issue.message}`}
					className={
						issue.severity === "error"
							? "text-destructive text-xs"
							: "text-muted-foreground text-xs"
					}
				>
					{issue.message}
				</li>
			))}
		</ul>
	);
}
