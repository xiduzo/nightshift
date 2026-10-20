/** How far a run is, and what it cost, in its details. */
import { Badge } from "@nightshift/ui/components/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { useMemo } from "react";
import { InspectorSection } from "@/features/flows";
import type { RunDetail, StepSummary } from "@/shared/api";
import { type KnownCost, sumKnownCost } from "@/shared/format";
import { CostText } from "../cost-text";
import { RunStatusBadge } from "../run-status-badge";
import { Fact } from "./run-facts";

/** The nodes that spent the most, at most this many. */
const TOP_NODES = 5;

/** How far the run got: its steps, its Gates, and the flows it called. */
export function ProgressSection({
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
export function CostSection({
	run,
	steps,
}: {
	run: RunDetail;
	steps: StepSummary[];
}) {
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
