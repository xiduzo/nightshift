import { Badge } from "@nightshift/ui/components/badge";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { cn } from "@nightshift/ui/lib/utils";
import type { ReactNode } from "react";
import type { Artifact, RunDetail, RunFiles, StepSummary } from "@/shared/api";
import { showsRunFiles } from "../lib/run-files";
import { RunArtifacts } from "./run-artifacts";
import { RunFilesList } from "./run-files";
import { RunVariables, ValuePreview, variableCount } from "./run-variables";
import { type Source, SourceList } from "./step-sources";

/**
 * Beside the run's story, at a fixed width: the inputs the run started
 * with, its variables now, the artifacts its agents kept, the files in its
 * own folder (a project without a folder) and the knowledge they used.
 * Each part shows only when the run has it.
 */
export function RunSidebar({
	run,
	steps,
	artifacts,
	files,
	onShowStep,
	className,
}: {
	run: RunDetail;
	/** Every step of the run, for the variables. */
	steps: StepSummary[];
	/** The files the run's agents kept. */
	artifacts: Artifact[];
	/** The files in the run's own folder. Undefined for a run in a copy of the project. */
	files?: RunFiles;
	onShowStep: (stepId: string) => void;
	className?: string;
}) {
	const inputs = Object.entries(run.inputs ?? {});
	const variables = variableCount(run, steps);
	const knowledge = usedSources(steps);
	if (
		inputs.length === 0 &&
		variables === 0 &&
		artifacts.length === 0 &&
		!showsRunFiles(files) &&
		knowledge.length === 0
	) {
		return null;
	}

	return (
		<aside
			aria-label="About the run"
			className={cn("flex w-80 shrink-0 flex-col border-l", className)}
		>
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col gap-6 p-4">
					{inputs.length > 0 ? (
						<Section title="Inputs" count={inputs.length}>
							<Table className="text-xs">
								<TableHeader>
									<TableRow>
										<TableHead>Input</TableHead>
										<TableHead className="text-right">Value</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{inputs.map(([name, value]) => (
										<TableRow key={name}>
											<TableCell className="whitespace-nowrap font-mono">
												{name}
											</TableCell>
											<TableCell className="w-full max-w-0 truncate text-right font-mono text-muted-foreground">
												<ValuePreview value={value} />
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</Section>
					) : null}
					{variables > 0 ? (
						<Section
							title="Variables"
							count={variables}
							hint="Values now. A step writes its variables when it ends."
						>
							<RunVariables
								run={run}
								steps={steps}
								onShowStep={onShowStep}
								className="p-0"
							/>
						</Section>
					) : null}
					{artifacts.length > 0 ? (
						<Section title="Artifacts" count={artifacts.length}>
							<RunArtifacts
								run={run}
								steps={steps}
								artifacts={artifacts}
								onShowStep={onShowStep}
								layout="table"
							/>
						</Section>
					) : null}
					{showsRunFiles(files) ? (
						<Section
							title="Files"
							count={files.here ? files.files.length : undefined}
						>
							<RunFilesList run={run} files={files} />
						</Section>
					) : null}
					{knowledge.length > 0 ? (
						<Section title="Knowledge" count={knowledge.length}>
							<SourceList
								sources={knowledge.map((use) => use.source)}
								note={(source) => {
									const users =
										knowledge.find((use) => use.source.path === source.path)
											?.steps ?? [];
									return (
										<span className="flex flex-wrap gap-x-2 text-muted-foreground text-xs">
											{users.map((step) => (
												<button
													key={step.id}
													type="button"
													className="rounded-sm font-mono underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
													onClick={() => onShowStep(step.id)}
												>
													{step.nodeId}
												</button>
											))}
										</span>
									);
								}}
							/>
						</Section>
					) : null}
				</div>
			</ScrollArea>
		</aside>
	);
}

function Section({
	title,
	count,
	hint,
	children,
}: {
	title: string;
	/** Left out when there is nothing to count here. */
	count?: number;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<section aria-label={title} className="flex flex-col gap-2">
			<h2 className="flex items-center gap-2 font-semibold text-sm">
				{title}
				{count === undefined ? null : (
					<Badge variant="secondary" className="tabular-nums">
						{count}
					</Badge>
				)}
			</h2>
			{hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
			{children}
		</section>
	);
}

/** Every knowledge file the run's agents used, once, with the steps that used it. Read beats found. */
function usedSources(
	steps: StepSummary[],
): { source: Source; steps: StepSummary[] }[] {
	const byPath = new Map<string, { source: Source; steps: StepSummary[] }>();
	for (const step of steps) {
		for (const source of step.sources ?? []) {
			const use = byPath.get(source.path);
			if (!use) {
				byPath.set(source.path, { source, steps: [step] });
				continue;
			}
			if (source.read && !use.source.read) use.source = source;
			if (!use.steps.includes(step)) use.steps.push(step);
		}
	}
	return [...byPath.values()];
}
