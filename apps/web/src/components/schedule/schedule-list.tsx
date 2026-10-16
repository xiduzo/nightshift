import { describeCron, type Schedule } from "@nightshift/flows";
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
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
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
import { Switch } from "@nightshift/ui/components/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CalendarClockIcon,
	CircleAlertIcon,
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
		<Card className="gap-0 pb-0">
			<CardHeader className="border-b pb-4 [.border-b]:pb-4">
				<CardTitle>
					<h2 id="schedules-heading">Schedules</h2>
				</CardTitle>
				<CardDescription>
					Flows the daemon starts on its own, saved in{" "}
					<span className="font-mono text-xs">.nightshift/schedules.json</span>
				</CardDescription>
				<CardAction>
					<Button
						variant="outline"
						size="sm"
						disabled={list.isLoading}
						onClick={() => setEditing({ schedule: null })}
					>
						<PlusIcon data-icon="inline-start" />
						<span className="max-sm:sr-only">New schedule</span>
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent className="px-0">
				<section aria-labelledby="schedules-heading">
					{list.data && list.data.issues.length > 0 ? (
						<div className="px-6 pt-4">
							<Alert>
								<CircleAlertIcon aria-hidden="true" />
								<AlertDescription>
									<IssueLines issues={list.data.issues} />
								</AlertDescription>
							</Alert>
						</div>
					) : null}

					{list.isLoading ? (
						<div className="flex flex-col gap-2 px-6 py-4">
							<Skeleton className="h-10 w-full" />
						</div>
					) : schedules.length === 0 ? (
						<Empty className="py-10 md:py-10">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<CalendarClockIcon aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>No schedules</EmptyTitle>
								<EmptyDescription>
									{list.error
										? list.error.message
										: "Start a flow without a person, for example every night at 22:00 with a stop time of 07:00."}
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
					) : (
						<Table>
							<TableHeader>
								<TableRow className="hover:bg-transparent">
									<TableHead className="pl-6">Flow</TableHead>
									<TableHead className="hidden md:table-cell">When</TableHead>
									<TableHead className="hidden lg:table-cell">
										Next start
									</TableHead>
									<TableHead className="hidden xl:table-cell">
										Last start
									</TableHead>
									<TableHead className="w-0">On</TableHead>
									<TableHead className="w-0 pr-6">
										<span className="sr-only">Actions</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{schedules.map((schedule) => (
									<ScheduleRow
										key={schedule.id}
										schedule={schedule}
										busy={save.isPending}
										onToggle={(enabled) =>
											saveAll(
												schedules.map((s) =>
													s.id === schedule.id
														? { ...plain(s), enabled }
														: plain(s),
												),
											)
										}
										onEdit={() => setEditing({ schedule: plain(schedule) })}
										onDelete={() => setToDelete(schedule)}
									/>
								))}
							</TableBody>
						</Table>
					)}
				</section>
			</CardContent>

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
							{save.isPending ? <Spinner data-icon="inline-start" /> : null}
							{save.isPending ? "Removing…" : "Remove schedule"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
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
	const errors = schedule.issues.filter((issue) => issue.severity === "error");
	const when = (
		<>
			{describeCron(schedule.cron)}
			{schedule.stopAt ? `, stops ${schedule.stopAt}` : ""}
		</>
	);
	const next = !schedule.enabled ? (
		"Paused"
	) : schedule.nextAt === null ? (
		"No next start"
	) : schedule.nextAt <= now ? (
		"Starts now"
	) : (
		<>
			<time
				dateTime={new Date(schedule.nextAt).toISOString()}
				title={formatDateTime(schedule.nextAt)}
				className="text-foreground"
			>
				{dayWord(schedule.nextAt, now)}, {formatDayTime(schedule.nextAt)}
			</time>{" "}
			<span className="tabular-nums">
				(in {formatWaited(schedule.nextAt - now)})
			</span>
		</>
	);
	return (
		<TableRow
			className={schedule.enabled ? undefined : "text-muted-foreground"}
		>
			<TableCell className="w-full max-w-0 whitespace-normal py-3 pl-6 align-top">
				<div className="flex min-w-0 flex-col gap-0.5">
					<span className="truncate font-medium font-mono">
						{schedule.flow}
					</span>
					<InputsLine inputs={schedule.inputs} baseRef={schedule.baseRef} />
					{/* The hidden columns, as lines, on narrow screens. */}
					<span className="text-xs md:hidden">{when}</span>
					<span className="text-muted-foreground text-xs lg:hidden">
						{schedule.enabled && schedule.nextAt !== null ? "Next " : null}
						{next}
					</span>
					<div className="xl:hidden">
						{schedule.last ? <LastResult result={schedule.last} /> : null}
					</div>
					{errors.length > 0 ? <IssueLines issues={errors} /> : null}
				</div>
			</TableCell>
			<TableCell className="hidden whitespace-normal py-3 align-top md:table-cell">
				<div className="flex flex-col gap-0.5">
					<span>{when}</span>
					<span className="font-mono text-muted-foreground text-xs">
						{schedule.cron}
					</span>
				</div>
			</TableCell>
			<TableCell className="hidden py-3 align-top text-muted-foreground lg:table-cell">
				{next}
			</TableCell>
			<TableCell className="hidden py-3 align-top xl:table-cell">
				{schedule.last ? <LastResult result={schedule.last} /> : "—"}
			</TableCell>
			<TableCell className="w-0 py-3 align-top">
				<Switch
					checked={schedule.enabled}
					disabled={busy}
					aria-label={`Schedule of ${schedule.flow} on`}
					onCheckedChange={(checked) => onToggle(checked === true)}
					className="mt-0.5"
				/>
			</TableCell>
			<TableCell className="w-0 py-3 pr-6 align-top">
				<div className="-my-1 flex items-center gap-0.5">
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`Edit the schedule of ${schedule.flow}`}
									onClick={onEdit}
								/>
							}
						>
							<PencilIcon />
						</TooltipTrigger>
						<TooltipContent>Edit schedule</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`Remove the schedule of ${schedule.flow}`}
									onClick={onDelete}
								/>
							}
						>
							<Trash2Icon />
						</TooltipTrigger>
						<TooltipContent>Remove schedule</TooltipContent>
					</Tooltip>
				</div>
			</TableCell>
		</TableRow>
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
		<p className="truncate font-mono text-muted-foreground text-xs">
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
			<p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground text-xs">
				<span>{when}</span>
				<Link
					to="/runs/$runId"
					params={{ runId: result.runId }}
					className="flex items-center gap-1.5 rounded-4xl underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
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
			<p className="whitespace-normal text-destructive text-xs">
				{when}: did not start. {result.error}
			</p>
		);
	}
	return (
		<p className="whitespace-normal text-muted-foreground text-xs">
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
							? "whitespace-normal text-destructive text-xs"
							: "whitespace-normal text-muted-foreground text-xs"
					}
				>
					{issue.message}
				</li>
			))}
		</ul>
	);
}
