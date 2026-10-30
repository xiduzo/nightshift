import { changedFiles, stepTodos } from "@nightshift/client";
import type { OutcomeColor } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { cn } from "@nightshift/ui/lib/utils";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import type {
	RunStatus,
	StepSummary,
	WorktreeChangesEvent,
} from "@/shared/api";
import { stepGist } from "../lib/step-gist";
import type { TranscriptItem } from "../transcript/transcript-items";
import { ChangedFiles } from "./changed-files";
import { StepFacts, StepLine, StepOutputs } from "./step-header";
import { StepPlan } from "./step-plan";

/** The height of the closed console: its bar alone. */
export const CONSOLE_BAR_PX = 44;

/**
 * The selected step along the bottom of the run page, like a browser's
 * devtools. Closed, it is one line: the step and what it did in a few words.
 * Open, it shows everything at once: the step's facts, summary and outputs
 * on the left, with the agent's to-do list and the files the step changed
 * (by the agent's edits and by commands), and its transcript (what the
 * agent ran and said) on the right.
 */
export function StepConsole({
	step,
	runStatus,
	open,
	onOpenChange,
	summary,
	transcript,
	items,
	changes,
	projectRoot,
	empty,
	outcomeColor,
	className,
}: {
	step: StepSummary | undefined;
	runStatus: RunStatus;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Why the step failed, what it said it did, its last output. */
	summary: ReactNode;
	/** The live transcript. */
	transcript: ReactNode;
	/** The step's transcript items, for the agent's to-do list and the files it changed. */
	items: readonly TranscriptItem[];
	/** Every file the step changed in the run's copy of the project, when Night Shift could tell. */
	changes?: WorktreeChangesEvent;
	/** The project's folder of the run, to show changed files relative to it. */
	projectRoot: string;
	/** Shown in the bar while there is no step. */
	empty: string;
	/** The colour the step's node gives its outcome. */
	outcomeColor?: OutcomeColor;
	className?: string;
}) {
	const gist = step ? stepGist(step) : undefined;
	const outputCount = step ? Object.keys(step.outputs).length : 0;
	// A subagent's calls change files too: they sit inside the call that started it.
	const calls = useMemo(
		() =>
			items.flatMap((item) =>
				item.kind === "tool"
					? [item, ...(item.steps ?? []).filter((step) => step.kind === "tool")]
					: [],
			),
		[items],
	);
	const todos = useMemo(() => stepTodos(calls), [calls]);
	// Also what commands changed, and a Command step's files.
	const files = useMemo(
		() => changedFiles(calls, projectRoot, changes),
		[calls, projectRoot, changes],
	);

	return (
		<section
			aria-label="The selected step"
			className={cn("flex flex-col bg-background", className)}
		>
			<div
				className={cn(
					"flex h-11 shrink-0 items-center gap-3 px-4",
					open && "border-b",
				)}
			>
				{step ? (
					<>
						<div className="min-w-0 max-w-[60%] shrink-0">
							<StepLine
								step={step}
								runStatus={runStatus}
								outcomeColor={outcomeColor}
							/>
						</div>
						{open ? null : (
							<p
								className={cn(
									"min-w-0 flex-1 truncate text-xs",
									step.error ? "text-destructive" : "text-muted-foreground",
								)}
								title={gist}
							>
								{gist}
							</p>
						)}
						<Button
							variant="ghost"
							size="sm"
							className="ml-auto shrink-0"
							aria-expanded={open}
							onClick={() => onOpenChange(!open)}
						>
							{open ? (
								<ChevronDownIcon data-icon="inline-start" />
							) : (
								<ChevronUpIcon data-icon="inline-start" />
							)}
							{open ? "Hide" : "Details"}
						</Button>
					</>
				) : (
					<p className="text-muted-foreground text-xs">{empty}</p>
				)}
			</div>
			{open && step ? (
				<div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-rows-[minmax(0,1fr)] lg:divide-x">
					<ScrollArea className="h-2/5 shrink-0 border-b lg:h-auto lg:min-h-0 lg:border-b-0">
						<div className="flex flex-col gap-5 p-4">
							<StepFacts step={step} />
							{todos ? (
								<StepPlan todos={todos} running={step.outcome === null} />
							) : null}
							{summary}
							{files.length > 0 ? (
								<ChangedFiles
									files={files}
									marksCommands={step.nodeType === "agent"}
									overlapped={changes?.overlapped === true}
									omitted={changes?.omitted ?? 0}
									title={
										<SectionTitle
											id="step-files-heading"
											aside={
												<Badge variant="secondary" className="tabular-nums">
													{files.length}
												</Badge>
											}
										>
											Changed files
										</SectionTitle>
									}
								/>
							) : null}
							<section
								aria-labelledby="step-outputs-heading"
								className="flex flex-col gap-2"
							>
								<SectionTitle
									id="step-outputs-heading"
									aside={
										<Badge variant="secondary" className="tabular-nums">
											{outputCount}
										</Badge>
									}
								>
									Outputs
								</SectionTitle>
								<StepOutputs step={step} />
							</section>
						</div>
					</ScrollArea>
					<section
						aria-labelledby="step-transcript-heading"
						className="flex min-h-0 flex-1 flex-col bg-muted/20"
					>
						{/* The transcript draws its own bar, with its copy actions. */}
						<div className="flex min-h-0 flex-1 flex-col">{transcript}</div>
					</section>
				</div>
			) : null}
		</section>
	);
}

/** The small uppercase heading of a part of the console. */
export function SectionTitle({
	id,
	aside,
	children,
}: {
	id: string;
	aside?: ReactNode;
	children: ReactNode;
}) {
	return (
		<h3
			id={id}
			className="flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wider"
		>
			{children}
			{aside}
		</h3>
	);
}
