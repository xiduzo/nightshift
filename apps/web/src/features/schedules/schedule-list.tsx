import { waitedText } from "@nightshift/client";
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
import { Switch } from "@nightshift/ui/components/switch";
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
	PowerOffIcon,
	Trash2Icon,
	WebhookIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { RunStatusBadge } from "@/features/runs";
import { settingsQueries } from "@/features/settings";
import type {
	ScheduleIssue,
	ScheduleResult,
	ScheduleSummary,
} from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import {
	dayWord,
	formatDateTime,
	formatDayTime,
	formatTime,
	useNow,
} from "@/shared/format";
import { PageHeading } from "@/shared/page";
import { scheduleMutations, scheduleQueries } from "./queries";
import { ScheduleDialog } from "./schedule-dialog";
import { LastDelivery, WebhookDialog } from "./webhook-deliveries";

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

/** What a schedule starts, for its name in the list: its flow, else its signal. */
function nameOf(schedule: Schedule): string {
	return schedule.flow ?? schedule.signal?.name ?? schedule.id;
}

/** When it starts, in words: its cron line, or a webhook. */
function whenText(schedule: Schedule): string {
	if (schedule.webhook) return "When a webhook arrives";
	return schedule.cron ? describeCron(schedule.cron) : "Never";
}

/**
 * The project's schedules, `.nightshift/schedules.json`: what starts when,
 * the next start, and how the last start went. Pause, edit, add, remove.
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
				description="Flows that start on their own, at set times or when a webhook arrives."
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
			<Card className="py-0">
				<CardContent className="px-0">
					{list.data && list.data.issues.length > 0 ? (
						<div className="px-6 pt-4 pb-2">
							<Alert>
								<CircleAlertIcon aria-hidden="true" />
								<AlertDescription>
									<IssueLines issues={list.data.issues} />
								</AlertDescription>
							</Alert>
						</div>
					) : null}

					{schedulerOff && schedules.length > 0 ? (
						<div className="px-6 pt-4 pb-2">
							<Alert>
								<PowerOffIcon aria-hidden="true" />
								<AlertDescription>
									{schedulerLock ?? (
										<>
											Schedules are paused, so no flow starts on its own. Turn
											them on in{" "}
											<Link
												to="/settings"
												className="underline underline-offset-4"
											>
												Settings
											</Link>
											.
										</>
									)}
								</AlertDescription>
							</Alert>
						</div>
					) : null}

					{list.isLoading ? (
						<div className="flex flex-col gap-2 px-6 py-4">
							<Skeleton className="h-10 w-full" />
						</div>
					) : schedules.length === 0 ? (
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
					) : (
						<DataTable
							columns={scheduleColumns({
								now,
								busy: save.isPending,
								schedulerOff,
								onToggle: (schedule, enabled) =>
									saveAll(
										schedules.map((s) =>
											s.id === schedule.id
												? { ...plain(s), enabled }
												: plain(s),
										),
									),
								onEdit: (schedule) => setEditing({ schedule: plain(schedule) }),
								onDelete: setToDelete,
								onWebhook: (schedule) => setHookOf(schedule.id),
							})}
							data={schedules}
							getRowId={(schedule) => schedule.id}
							rowClassName={(schedule) =>
								schedule.enabled ? undefined : "text-muted-foreground"
							}
						/>
					)}
				</CardContent>
			</Card>

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

const column = dataTableColumns<ScheduleSummary>();

/**
 * When a schedule starts next, or why it does not. `stacked` puts the
 * countdown on its own line, as the table column shows it.
 */
function nextStart(
	schedule: ScheduleSummary,
	now: number,
	schedulerOff: boolean,
	stacked = false,
): ReactNode {
	if (!schedule.enabled) return "Paused";
	if (schedulerOff) return "Schedules paused";
	if (schedule.webhook) return "On each webhook";
	if (schedule.nextAt === null) return "No next start";
	if (schedule.nextAt <= now) return "Starts now";
	const time = (
		<time
			dateTime={new Date(schedule.nextAt).toISOString()}
			title={formatDateTime(schedule.nextAt)}
			className="text-foreground"
		>
			{dayWord(schedule.nextAt, now)}, {formatDayTime(schedule.nextAt)}
		</time>
	);
	const wait = waitedText(schedule.nextAt - now);
	if (stacked) {
		return (
			<div className="flex flex-col gap-0.5">
				{time}
				<span className="text-xs tabular-nums">in {wait}</span>
			</div>
		);
	}
	return (
		<>
			{time} <span className="tabular-nums">(in {wait})</span>
		</>
	);
}

function When({ schedule }: { schedule: ScheduleSummary }) {
	return (
		<>
			{whenText(schedule)}
			{schedule.stopAt ? `, stops ${schedule.stopAt}` : ""}
		</>
	);
}

function scheduleColumns({
	now,
	busy,
	schedulerOff,
	onToggle,
	onEdit,
	onDelete,
	onWebhook,
}: {
	now: number;
	busy: boolean;
	/** The daemon's scheduler is off: nothing starts, whatever the cron says. */
	schedulerOff: boolean;
	onToggle: (schedule: ScheduleSummary, enabled: boolean) => void;
	onEdit: (schedule: ScheduleSummary) => void;
	onDelete: (schedule: ScheduleSummary) => void;
	/** Shows a webhook schedule's address, secret and latest webhooks. */
	onWebhook: (schedule: ScheduleSummary) => void;
}) {
	return column.columns([
		column.accessor("flow", {
			header: "Flow",
			cell: ({ row: { original: schedule } }) => {
				const errors = schedule.issues.filter(
					(issue) => issue.severity === "error",
				);
				return (
					<div className="flex min-w-0 flex-col gap-0.5">
						<span className="truncate font-medium font-mono">
							{nameOf(schedule)}
						</span>
						<InputsLine inputs={schedule.inputs} baseRef={schedule.baseRef} />
						{schedule.signal ? (
							<p className="truncate text-muted-foreground text-xs">
								Wakes the runs that wait for{" "}
								<span className="font-mono">{schedule.signal.name}</span>
							</p>
						) : null}
						{/* The hidden columns, as lines, on narrow screens. */}
						<span className="text-xs md:hidden">
							<When schedule={schedule} />
						</span>
						<span className="text-muted-foreground text-xs lg:hidden">
							{schedule.enabled && !schedulerOff && schedule.nextAt !== null
								? "Next "
								: null}
							{nextStart(schedule, now, schedulerOff)}
						</span>
						<div className="xl:hidden">
							<Latest schedule={schedule} />
						</div>
						{errors.length > 0 ? <IssueLines issues={errors} /> : null}
					</div>
				);
			},
			meta: {
				headClassName: "pl-6",
				cellClassName: "w-2/5 max-w-0 whitespace-normal py-3 pl-6 align-top",
			},
		}),
		column.accessor("cron", {
			header: "When",
			cell: ({ row: { original: schedule } }) => (
				<div className="flex flex-col gap-0.5">
					<span>
						<When schedule={schedule} />
					</span>
					<span className="font-mono text-muted-foreground text-xs">
						{schedule.webhook ? schedule.webhook.when : schedule.cron}
					</span>
				</div>
			),
			meta: {
				headClassName: "hidden md:table-cell",
				cellClassName: "hidden py-3 align-top md:table-cell",
			},
		}),
		column.accessor("nextAt", {
			header: "Next start",
			cell: ({ row }) => nextStart(row.original, now, schedulerOff, true),
			meta: {
				headClassName: "hidden lg:table-cell",
				cellClassName:
					"hidden py-3 align-top text-muted-foreground lg:table-cell",
			},
		}),
		column.accessor("last", {
			header: "Last start",
			cell: ({ row }) => <Latest schedule={row.original} />,
			meta: {
				headClassName: "hidden xl:table-cell",
				cellClassName: "hidden py-3 align-top xl:table-cell",
			},
		}),
		column.accessor("enabled", {
			header: "On",
			cell: ({ row: { original: schedule } }) => (
				<Switch
					checked={schedule.enabled}
					disabled={busy}
					aria-label={`Schedule of ${nameOf(schedule)} on`}
					onCheckedChange={(checked) => onToggle(schedule, checked === true)}
					className="mt-0.5"
				/>
			),
			meta: { headClassName: "w-0", cellClassName: "w-0 py-3 align-top" },
		}),
		column.display({
			id: "actions",
			header: () => <span className="sr-only">Actions</span>,
			cell: ({ row: { original: schedule } }) => (
				<div className="-my-1 flex items-center gap-0.5">
					{schedule.webhook ? (
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`The webhook of ${nameOf(schedule)}`}
										onClick={() => onWebhook(schedule)}
									/>
								}
							>
								<WebhookIcon />
							</TooltipTrigger>
							<TooltipContent>Address and recent webhooks</TooltipContent>
						</Tooltip>
					) : null}
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`Edit the schedule of ${nameOf(schedule)}`}
									onClick={() => onEdit(schedule)}
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
									aria-label={`Remove the schedule of ${nameOf(schedule)}`}
									onClick={() => onDelete(schedule)}
								/>
							}
						>
							<Trash2Icon />
						</TooltipTrigger>
						<TooltipContent>Remove schedule</TooltipContent>
					</Tooltip>
				</div>
			),
			meta: {
				headClassName: "w-0 pr-6",
				cellClassName: "w-0 py-3 pr-6 align-top",
			},
		}),
	]);
}

/** How the last start went: the cron time's result, or the latest webhook. */
function Latest({ schedule }: { schedule: ScheduleSummary }) {
	if (schedule.webhook) {
		const [latest] = schedule.deliveries;
		return latest ? <LastDelivery delivery={latest} /> : "—";
	}
	return schedule.last ? <LastResult result={schedule.last} /> : "—";
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
