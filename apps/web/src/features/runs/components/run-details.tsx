import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetTitle,
	SheetTrigger,
} from "@nightshift/ui/components/sheet";
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
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { CopyIcon, InfoIcon, MonitorIcon, WorkflowIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { walkerName } from "@/features/devices";
import { InspectorHeader, InspectorSection } from "@/features/flows";
import type { RunDetail, RunStatus, StepSummary } from "@/shared/api";
import { authClient } from "@/shared/api";
import {
	formatDateTime,
	formatDayTime,
	type KnownCost,
	sumKnownCost,
} from "@/shared/format";
import { previewValue, variableGroups } from "../lib/run-variables";
import { CostText } from "./cost-text";

import { Elapsed } from "./elapsed";
import { RunStatusBadge } from "./run-status-badge";
import { ScopeTitle, SetBy, TYPE_LABEL, ValuePreview } from "./run-variables";

/** A git object id: shown short, with the full id in a tooltip. */
const SHA = /^[0-9a-f]{40}$/i;

/** The nodes that spent the most, at most this many. */
const TOP_NODES = 5;

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
				<InspectorHeader
					icon={WorkflowIcon}
					kicker="Run"
					badges={<RunStatusBadge status={status} />}
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
	// Counts up while a step runs; otherwise ends at the last step's end.
	const lastEnd = steps.some((step) => step.endedAt === null)
		? null
		: Math.max(run.createdAt, ...steps.map((step) => step.endedAt ?? 0));

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
				<Fact label="Started by">
					<StartedBy run={run} />
				</Fact>
				<div className="grid grid-cols-2 gap-3">
					<Fact label="Started">
						<Time at={run.createdAt} />
					</Fact>
					<Fact label={ended ? "Ran for" : "Running for"}>
						<span className="tabular-nums">
							<Elapsed start={run.createdAt} end={lastEnd} />
						</span>
					</Fact>
				</div>
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

/** The values the run started with. Left out when the flow has no inputs. */
function InputsSection({ run }: { run: RunDetail }) {
	const inputs = Object.entries(run.inputs ?? {});
	if (inputs.length === 0) return null;
	return (
		<InspectorSection title="Inputs" aside={<Count n={inputs.length} />}>
			<dl className="flex flex-col gap-3">
				{inputs.map(([name, value]) => (
					<Fact key={name} label={name} mono>
						<span
							className="truncate font-mono text-xs"
							title={previewValue(value, 400)}
						>
							<ValuePreview value={value} />
						</span>
					</Fact>
				))}
			</dl>
		</InspectorSection>
	);
}

/**
 * Each variable's value now, per flow the run ran, and the step that set
 * it. Left out while the run has no variables.
 */
function VariablesSection({
	run,
	steps,
	onShowStep,
}: {
	run: RunDetail;
	steps: StepSummary[];
	onShowStep: (stepId: string) => void;
}) {
	const groups = useMemo(() => variableGroups(run, steps), [run, steps]);
	if (groups.length === 0) return null;
	const count = groups.reduce((sum, group) => sum + group.rows.length, 0);
	return (
		<InspectorSection title="Variables" aside={<Count n={count} />}>
			{groups.map((group) => (
				<section key={group.key} className="flex flex-col gap-3">
					{groups.length > 1 ? (
						<h4 className="text-muted-foreground text-xs">
							{group.scope ? (
								<ScopeTitle run={run} steps={steps} scope={group.scope} />
							) : (
								<span className="font-mono">{run.flowName ?? "This run"}</span>
							)}
						</h4>
					) : null}
					<dl className="flex flex-col gap-3">
						{group.rows.map((row) => (
							<div key={row.name} className="flex min-w-0 flex-col gap-1">
								<dt className="flex items-center gap-1.5 text-xs">
									<span className="truncate font-mono text-muted-foreground">
										{row.name}
									</span>
									{row.type ? (
										<Badge variant="outline">{TYPE_LABEL[row.type]}</Badge>
									) : null}
									<span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
										{row.last.stepId === null ? null : "Set by"}
										<SetBy
											change={row.last}
											steps={steps}
											onShowStep={onShowStep}
										/>
									</span>
								</dt>
								<dd className="min-w-0 truncate font-mono text-sm">
									<ValuePreview value={row.last.value} />
								</dd>
							</div>
						))}
					</dl>
				</section>
			))}
		</InspectorSection>
	);
}

/** How far the run got: its steps, its Gates, and the flows it called. */
function ProgressSection({
	run,
	steps,
}: {
	run: RunDetail;
	steps: StepSummary[];
}) {
	const failed = steps.filter((step) => step.error !== null).length;
	const openGates = run.gates.filter((gate) => gate.closedAt === null).length;
	return (
		<InspectorSection title="Progress">
			<dl className="grid grid-cols-2 gap-3">
				<Fact label="Steps">
					<span className="tabular-nums">{steps.length}</span>
					{failed > 0 ? (
						<Badge
							variant="outline"
							className="border-destructive/40 text-destructive"
						>
							{failed} failed
						</Badge>
					) : null}
				</Fact>
				<Fact label="Gates">
					<span className="tabular-nums">{run.gates.length}</span>
					{openGates > 0 ? (
						<Badge
							variant="outline"
							className="border-status-waiting/40 text-status-waiting"
						>
							{openGates} open
						</Badge>
					) : null}
				</Fact>
			</dl>
			{run.subflows.length > 0 ? (
				<Table className="text-xs">
					<TableHeader>
						<TableRow>
							<TableHead>Called flow</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Cost</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{run.subflows.map((subflow) => (
							<TableRow key={`${subflow.flowName}-${subflow.startedAt}`}>
								<TableCell className="max-w-36 truncate font-mono">
									{subflow.flowName}
								</TableCell>
								<TableCell>
									<RunStatusBadge status={subflow.status} />
								</TableCell>
								<TableCell className="text-right tabular-nums">
									<CostText cost={subflow} />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			) : null}
		</InspectorSection>
	);
}

/** What the run cost, and the nodes that spent the most of it. */
function CostSection({ run, steps }: { run: RunDetail; steps: StepSummary[] }) {
	const byNode = useMemo(() => costByNode(steps), [steps]);
	return (
		<InspectorSection title="Cost">
			<dl>
				<Fact label="Total">
					<CostText cost={run} className="font-medium tabular-nums" />
				</Fact>
			</dl>
			{byNode.length > 0 ? (
				<Table className="text-xs">
					<TableHeader>
						<TableRow>
							<TableHead>Most spent</TableHead>
							<TableHead className="text-right">Steps</TableHead>
							<TableHead className="text-right">Cost</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{byNode.map((node) => (
							<TableRow key={node.nodeId}>
								<TableCell className="max-w-40 truncate font-mono">
									{node.nodeId}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{node.steps}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									<CostText cost={node.cost} />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			) : null}
		</InspectorSection>
	);
}

/** The nodes that spent anything, most first: their steps together, at most `TOP_NODES`. */
function costByNode(
	steps: readonly StepSummary[],
): { nodeId: string; steps: number; cost: KnownCost }[] {
	const byNode = new Map<string, StepSummary[]>();
	for (const step of steps) {
		byNode.set(step.nodeId, [...(byNode.get(step.nodeId) ?? []), step]);
	}
	return [...byNode.entries()]
		.map(([nodeId, nodeSteps]) => ({
			nodeId,
			steps: nodeSteps.length,
			cost: sumKnownCost(nodeSteps),
		}))
		.filter((node) => node.cost.costUsd > 0)
		.sort((a, b) => b.cost.costUsd - a.cost.costUsd)
		.slice(0, TOP_NODES);
}

/** The branch the run works on, and the computer and folder it runs in. */
function WhereSection({ run }: { run: RunDetail }) {
	return (
		<InspectorSection title="Where it runs">
			<dl className="flex flex-col gap-3">
				<Fact label="Branch">
					<CopyValue label="branch" value={run.branch} />
				</Fact>
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
							{formatDayTime(resume.at)}
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
	if (!run.startedBy) {
		return <span className="text-muted-foreground">Not known</span>;
	}
	if (run.startedBy.id === session.data?.user.id) return <>You</>;
	return (
		<span className="truncate">{run.startedBy.name ?? "A former member"}</span>
	);
}

function Time({
	at,
	format = formatDateTime,
}: {
	at: number;
	format?: (epochMs: number) => string;
}) {
	return (
		<time
			dateTime={new Date(at).toISOString()}
			className="truncate tabular-nums"
		>
			{format(at)}
		</time>
	);
}

/** The number of things in a section, beside its heading. */
function Count({ n }: { n: number }) {
	return (
		<Badge variant="secondary" className="tabular-nums">
			{n}
		</Badge>
	);
}

/** One fact of the run: a small muted label above its value. */
function Fact({
	label,
	mono,
	className,
	children,
}: {
	label: string;
	/** The label is a name from the flow, such as an input. */
	mono?: boolean;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className={cn("flex min-w-0 flex-col gap-1", className)}>
			<dt
				className={cn(
					"truncate text-muted-foreground text-xs",
					mono && "font-mono",
				)}
			>
				{label}
			</dt>
			<dd className="flex min-h-6 min-w-0 items-center gap-1.5 text-sm">
				{children}
			</dd>
		</div>
	);
}

/** A mono value that may be cut short, with its full text in a tooltip and a copy button. */
function CopyValue({
	label,
	value,
	short,
}: {
	label: string;
	value: string;
	/** A shorter form to show, such as the start of a hash. */
	short?: string;
}) {
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			toast.success(`Copied the ${label}.`);
		} catch {
			toast.error("Could not copy.");
		}
	};
	return (
		<>
			<Tooltip>
				<TooltipTrigger
					render={<span className="min-w-0 truncate font-mono text-xs" />}
				>
					{short ?? value}
				</TooltipTrigger>
				<TooltipContent className="max-w-md break-all font-mono">
					{value}
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon-xs"
							className="text-muted-foreground"
							aria-label={`Copy the ${label}`}
							onClick={copy}
						/>
					}
				>
					<CopyIcon aria-hidden="true" />
				</TooltipTrigger>
				<TooltipContent>Copy</TooltipContent>
			</Tooltip>
		</>
	);
}
