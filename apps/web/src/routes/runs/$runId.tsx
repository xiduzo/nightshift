import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { ResumeComposer } from "@/components/run/resume-composer";
import { RunGraph } from "@/components/run/run-graph";
import { RunHeader } from "@/components/run/run-header";
import { StepHeader } from "@/components/run/step-header";
import { StepTimeline } from "@/components/run/step-timeline";
import { StepTranscript } from "@/components/transcript/step-transcript";
import { mergeSteps, useRunStream } from "@/hooks/use-run-stream";
import type { RunStatus } from "@/lib/api-types";
import { emptyTranscript } from "@/lib/transcript";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/runs/$runId")({
	// The transcript streams from the browser; nothing to render on the server.
	ssr: false,
	component: RunComponent,
});

const RESUMABLE: RunStatus[] = ["stopped", "failed", "interrupted"];

function RunComponent() {
	const { runId } = Route.useParams();
	const run = useQuery(orpc.runs.get.queryOptions({ input: { runId } }));
	const stream = useRunStream(runId);
	/** Null follows the latest step as the run walks. */
	const [pickedStepId, setPickedStepId] = useState<string | null>(null);

	const steps = useMemo(
		() => mergeSteps(run.data?.steps ?? [], stream.steps),
		[run.data?.steps, stream.steps],
	);

	if (run.isLoading) {
		return (
			<main className="flex flex-col gap-3 px-4 py-4">
				<Skeleton className="h-5 w-64" />
				<Skeleton className="h-4 w-full max-w-2xl" />
				<Skeleton className="h-40 w-full" />
			</main>
		);
	}

	if (!run.data) {
		return (
			<main className="px-4 py-6">
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>Run not available</EmptyTitle>
						<EmptyDescription>
							{run.error?.message ?? "This run does not exist."}{" "}
							<Link to="/">Back to projects</Link>
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</main>
		);
	}

	// The stream reports a status change before the refetched run arrives.
	const status = stream.status ?? run.data.status;
	const selectedStep =
		steps.find((step) => step.id === pickedStepId) ?? steps[steps.length - 1];
	const lastStep = steps[steps.length - 1];

	// The newest step of a gate without an outcome is the one the run waits at.
	const openGate =
		status === "waiting"
			? [...steps]
					.reverse()
					.find((step) => step.nodeType === "gate" && step.outcome === null)
			: undefined;

	const selectNode = (nodeId: string) => {
		const latest = [...steps].reverse().find((step) => step.nodeId === nodeId);
		if (latest) setPickedStepId(latest.id);
	};

	return (
		<main className="grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr]">
			<RunHeader
				run={run.data}
				status={status}
				reconnecting={stream.connection === "reconnecting"}
				openGateNodeId={openGate?.nodeId ?? null}
				onShowGate={() => openGate && setPickedStepId(openGate.id)}
			/>
			<div className="grid min-h-0 auto-rows-max grid-cols-[minmax(0,1fr)] overflow-y-auto lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
				<div className="grid min-h-0 grid-rows-[18rem_auto] border-b lg:grid-rows-[minmax(18rem,1fr)_auto] lg:border-r lg:border-b-0">
					<RunGraph
						flow={run.data.flow}
						steps={steps}
						traversals={run.data.traversals}
						selectedNodeId={selectedStep?.nodeId ?? null}
						onSelectNode={selectNode}
					/>
					<section
						aria-labelledby="steps-heading"
						className="flex max-h-72 min-h-0 flex-col border-t lg:max-h-[45vh]"
					>
						<header className="flex items-center gap-2 px-3 py-2">
							<h2 id="steps-heading" className="font-medium text-xs">
								Steps
							</h2>
							<span className="text-muted-foreground text-xs">
								{steps.length}
							</span>
							{pickedStepId ? (
								<button
									type="button"
									className="ml-auto text-muted-foreground text-xs underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring"
									onClick={() => setPickedStepId(null)}
								>
									Follow the latest step
								</button>
							) : null}
						</header>
						<div className="min-h-0 overflow-y-auto">
							<StepTimeline
								steps={steps}
								selectedStepId={selectedStep?.id ?? null}
								onSelect={setPickedStepId}
							/>
						</div>
					</section>
				</div>
				<div className="grid h-[75vh] grid-rows-[auto_1fr_auto] lg:h-auto lg:min-h-0">
					{selectedStep ? (
						<>
							<StepHeader step={selectedStep} />
							<StepTranscript
								key={selectedStep.id}
								runId={run.data.id}
								step={selectedStep}
								transcript={
									stream.transcript.steps.get(selectedStep.id) ??
									emptyTranscript
								}
								connecting={stream.connection === "connecting"}
							/>
						</>
					) : (
						<p className="row-span-2 px-4 py-8 text-center text-muted-foreground text-xs">
							{status === "running"
								? "Waiting for the first step…"
								: "This run has no steps."}
						</p>
					)}
					{RESUMABLE.includes(status) ? (
						<ResumeComposer runId={run.data.id} lastStep={lastStep} />
					) : null}
				</div>
			</div>
		</main>
	);
}
