import { Button } from "@nightshift/ui/components/button";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetTitle,
	SheetTrigger,
} from "@nightshift/ui/components/sheet";
import { Link } from "@tanstack/react-router";
import { InfoIcon, MonitorIcon, WorkflowIcon } from "lucide-react";
import { useState } from "react";
import { walkerName } from "@/features/devices";
import { InspectorSection, RunRevision } from "@/features/flows";
import type { RunDetail, RunStatus, StepSummary } from "@/shared/api";
import { authClient } from "@/shared/api";
import { formatDayTime } from "@/shared/format";
import { PanelHeader } from "@/shared/panel";
import { LocalTime } from "@/shared/time";
import { useWorkTime } from "../elapsed";
import { RunStatusBadge } from "../run-status-badge";
import { InputsSection, VariablesSection } from "./run-details-data";
import { CostSection, ProgressSection } from "./run-details-progress";
import { CopyValue, Count, Fact, Time } from "./run-facts";

/** A git object id: shown short, with the full id in a tooltip. */
const SHA = /^[0-9a-f]{40}$/i;

const ENDED: RunStatus[] = ["finished", "failed", "stopped", "interrupted"];

/**
 * A button in the page header that opens every fact of the run in a Sheet,
 * in folding sections like the node settings of the flow editor.
 */
export function RunDetails({
	run,
	steps,
	status,
	onShowStep,
}: {
	run: RunDetail;
	/** The run's steps as they stand, live. */
	steps: StepSummary[];
	status: RunStatus;
	onShowStep: (stepId: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const showStep = (stepId: string) => {
		setOpen(false);
		onShowStep(stepId);
	};

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger
				render={<Button variant="outline" size="sm" aria-label="Details" />}
			>
				<InfoIcon data-icon="inline-start" />
				<span className="hidden sm:inline">Details</span>
			</SheetTrigger>
			<SheetContent className="gap-0 data-[side=right]:sm:max-w-md">
				<PanelHeader
					icon={WorkflowIcon}
					kicker="Run"
					badges={<RunStatusBadge status={status} result={run.result} />}
					title={<SheetTitle render={<span />}>{run.title}</SheetTitle>}
					// The close button sits in the top right corner.
					className="pr-12"
				/>
				<ScrollArea className="min-h-0 flex-1">
					<div className="flex flex-col pb-6">
						<OverviewSection run={run} steps={steps} status={status} />
						<InputsSection run={run} />
						<VariablesSection run={run} steps={steps} onShowStep={showStep} />
						<ProgressSection run={run} steps={steps} />
						<CostSection run={run} steps={steps} />
						<WhereSection run={run} />
						<HistorySection run={run} />
					</div>
				</ScrollArea>
			</SheetContent>
		</Sheet>
	);
}

/** What the run is, who started it, and when it started and ended. */
function OverviewSection({
	run,
	steps,
	status,
}: {
	run: RunDetail;
	steps: StepSummary[];
	status: RunStatus;
}) {
	const ended = ENDED.includes(status);
	const time = useWorkTime(steps, run.createdAt);

	return (
		<InspectorSection title="Run">
			<dl className="flex flex-col gap-3">
				<Fact label="Flow">
					{run.flowName ? (
						<Link
							to="/projects/$projectId/flows/$name"
							params={{ projectId: run.projectId, name: run.flowName }}
							className="truncate rounded-sm font-mono underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							{run.flowName}
						</Link>
					) : (
						"Quick run"
					)}
				</Fact>
				{run.flowName && run.flowRevision ? (
					<Fact label="Revision">
						<RunRevision
							projectId={run.projectId}
							flowName={run.flowName}
							revisionId={run.flowRevision}
						/>
					</Fact>
				) : null}
				<Fact label="Started by">
					<StartedBy run={run} />
				</Fact>
				<div className="grid grid-cols-2 gap-3">
					<Fact label="Started">
						<Time at={run.createdAt} />
					</Fact>
					<Fact label={ended ? "Ran for" : "Running for"}>
						<span className="tabular-nums">{time.active}</span>
					</Fact>
				</div>
				{time.waited || time.slept ? (
					<div className="grid grid-cols-2 gap-3">
						{time.waited ? (
							<Fact label="Waited for you">
								<span className="tabular-nums">{time.waited}</span>
							</Fact>
						) : null}
						{time.slept ? (
							<Fact label="Slept">
								<span className="tabular-nums">{time.slept}</span>
							</Fact>
						) : null}
						<Fact label="Open for">
							<span className="tabular-nums">{time.open}</span>
						</Fact>
					</div>
				) : null}
				{ended && run.endedAt ? (
					<Fact label="Ended">
						<Time at={run.endedAt} />
					</Fact>
				) : null}
				{ended && run.reason ? (
					<Fact label="How it ended">
						<span className="line-clamp-3 whitespace-pre-line">
							{run.reason}
						</span>
					</Fact>
				) : null}
				{status === "sleeping" ? (
					<Fact label="Continues">
						{run.wakeAt ? (
							<Time at={run.wakeAt} format={formatDayTime} />
						) : run.signal ? (
							<span className="truncate">
								When <span className="font-mono">{run.signal}</span> comes in
							</span>
						) : (
							<span className="text-muted-foreground">Not known</span>
						)}
					</Fact>
				) : null}
				{ended ? null : (
					<Fact label="Stop time">
						{run.stopAt ? (
							<Time at={run.stopAt} format={formatDayTime} />
						) : (
							<span className="text-muted-foreground">None</span>
						)}
					</Fact>
				)}
			</dl>
		</InspectorSection>
	);
}

/** The branch the run works on, and the computer and folder it runs in. */
function WhereSection({ run }: { run: RunDetail }) {
	return (
		<InspectorSection title="Where it runs">
			<dl className="flex flex-col gap-3">
				{/* A run whose computer was offline at the start has no branch yet. */}
				{run.branch ? (
					<Fact label="Branch">
						<CopyValue label="branch" value={run.branch} />
					</Fact>
				) : null}
				<Fact label="Base">
					<CopyValue
						label="base"
						value={run.baseRef}
						short={SHA.test(run.baseRef) ? run.baseRef.slice(0, 12) : undefined}
					/>
				</Fact>
				<Fact label="Runs on">
					<MonitorIcon
						className="size-3.5 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					{deviceLabel(run.device)}
				</Fact>
				{run.walker.id !== run.device.id ? (
					<Fact label="Walked by">
						<MonitorIcon
							className="size-3.5 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
						{deviceLabel(run.walker)}
					</Fact>
				) : null}
				{run.handOffs.length > 0 ? (
					<Fact label="Work moved">
						<ul className="flex min-w-0 flex-col gap-1 text-xs">
							{run.handOffs.map((handOff) => (
								<li key={`${handOff.at}-${handOff.commit}`}>
									{deviceLabel(handOff.from)} → {deviceLabel(handOff.to)}{" "}
									<span className="font-mono text-muted-foreground">
										{handOff.commit.slice(0, 7)}
									</span>
								</li>
							))}
						</ul>
					</Fact>
				) : null}
				{run.walker.thisDevice && run.device.thisDevice ? (
					<Fact label="Folder">
						<CopyValue label="folder path" value={run.worktreePath} />
					</Fact>
				) : null}
			</dl>
		</InspectorSection>
	);
}

const RESUME_TEXT: Record<RunDetail["resumes"][number]["action"], string> = {
	resume: "Resumed at",
	restart: "Restarted the step at",
	rerun: "Ran again from",
};

/** Each time the run continued after a stop. Left out when it never stopped. */
function HistorySection({ run }: { run: RunDetail }) {
	if (run.resumes.length === 0) return null;
	return (
		<InspectorSection
			title="Resumes"
			aside={<Count n={run.resumes.length} />}
			defaultOpen={false}
		>
			<ul className="flex flex-col gap-2 text-xs">
				{run.resumes.map((resume) => (
					<li key={`${resume.at}-${resume.nodeId}`} className="flex gap-2">
						<span className="shrink-0 text-muted-foreground tabular-nums">
							<LocalTime at={resume.at}>{formatDayTime(resume.at)}</LocalTime>
						</span>
						<span className="min-w-0">
							{resume.by === "daemon"
								? "Resumed by Night Shift at"
								: RESUME_TEXT[resume.action]}{" "}
							<span className="font-mono">{resume.nodeId}</span>
							{resume.by === "daemon" ? (
								<span className="text-muted-foreground">
									. {resume.reason ?? "Night Shift restarted."}
								</span>
							) : null}
						</span>
					</li>
				))}
			</ul>
		</InspectorSection>
	);
}

/** A device of the run, as people read it: this computer, or its name. */
function deviceLabel(device: RunDetail["walker"]): string {
	return device.thisDevice ? "This computer" : walkerName(device);
}

/**
 * Who started the run: a schedule, you, or another Member of the Space.
 * Commits in the run are in the name of the person who started it.
 */
function StartedBy({ run }: { run: RunDetail }) {
	const session = authClient.useSession();
	if (run.trigger.kind === "schedule") {
		return <>Schedule · {run.trigger.scheduleId}</>;
	}
	if (run.trigger.kind === "webhook") {
		return <>Webhook · {run.trigger.scheduleId}</>;
	}
	if (!run.startedBy) {
		return <span className="text-muted-foreground">Not known</span>;
	}
	if (run.startedBy.id === session.data?.user.id) return <>You</>;
	return (
		<span className="truncate">{run.startedBy.name ?? "A former member"}</span>
	);
}
