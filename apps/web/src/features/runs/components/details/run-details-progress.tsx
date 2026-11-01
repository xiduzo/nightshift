/** How far a run is, and what it cost, in its details. */
import {
	metricsByNode,
	type NodeMetrics,
	tokensLabel,
} from "@nightshift/client";
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
import { formatDuration, formatTokens } from "@/shared/format";
import { CostText } from "../cost-text";
import { RunStatusBadge } from "../run-status-badge";
import { Fact } from "./run-facts";

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

/** What the run cost and used, and per node: its visits, time, tokens, cost and Gate wait. */
export function CostSection({
	run,
	steps,
}: {
	run: RunDetail;
	steps: StepSummary[];
}) {
	const nodes = useMemo(() => metricsByNode(steps), [steps]);
	const tokens = run.metrics?.tokens;
	const used = tokensLabel(tokens);
	const waited = nodes.some((node) => node.gateWaitMs > 0);
	return (
		<InspectorSection title="Cost and time">
			<dl className="grid grid-cols-2 gap-3">
				<Fact label="Total">
					{used ? (
						<>
							<span
								title={`${formatTokens(tokens?.input ?? 0)} in, ${formatTokens(tokens?.output ?? 0)} out`}
							>
								{used}
							</span>
							<span aria-hidden="true"> · </span>
						</>
					) : null}
					<CostText cost={run} className="font-medium tabular-nums" />
				</Fact>
				{run.metrics && run.metrics.agentMs > 0 ? (
					<Fact label="Agents worked">
						<span className="tabular-nums">
							{formatDuration(run.metrics.agentMs)}
						</span>
					</Fact>
				) : null}
				{run.metrics?.prUrl ? (
					<Fact label="Pull request">
						<a
							href={run.metrics.prUrl}
							target="_blank"
							rel="noreferrer"
							className="truncate underline underline-offset-4"
						>
							{pullRequestName(run.metrics.prUrl)}
						</a>
					</Fact>
				) : null}
			</dl>
			{nodes.length > 0 ? (
				<Table className="text-xs">
					<TableHeader>
						<TableRow>
							<TableHead>Node</TableHead>
							<TableHead className="text-right">Time</TableHead>
							<TableHead className="text-right">Tokens</TableHead>
							<TableHead className="text-right">Cost</TableHead>
							{waited ? (
								<TableHead className="text-right">Waited for you</TableHead>
							) : null}
						</TableRow>
					</TableHeader>
					<TableBody>
						{nodes.map((node) => (
							<NodeRow key={node.nodeId} node={node} waited={waited} />
						))}
					</TableBody>
				</Table>
			) : null}
		</InspectorSection>
	);
}

/** One node of the run: every visit of it together. */
function NodeRow({ node, waited }: { node: NodeMetrics; waited: boolean }) {
	const tokens = node.tokens.input + node.tokens.output;
	return (
		<TableRow>
			<TableCell className="max-w-36">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="truncate font-mono">{node.nodeId}</span>
					{node.visits > 1 ? (
						<span
							className="shrink-0 text-muted-foreground"
							title={`${node.visits} visits`}
						>
							×{node.visits}
						</span>
					) : null}
				</div>
			</TableCell>
			<TableCell className="text-right tabular-nums">
				{node.wallMs > 0 || !node.open ? formatDuration(node.wallMs) : null}
				{node.open ? (
					<span className="text-muted-foreground">
						{node.wallMs > 0 ? ", " : ""}running
					</span>
				) : null}
			</TableCell>
			<TableCell className="text-right tabular-nums">
				{tokens > 0 ? formatTokens(tokens) : "—"}
			</TableCell>
			<TableCell className="text-right tabular-nums">
				<CostText cost={node.cost} />
			</TableCell>
			{waited ? (
				<TableCell className="text-right tabular-nums">
					{node.gateWaitMs > 0 ? formatDuration(node.gateWaitMs) : "—"}
				</TableCell>
			) : null}
		</TableRow>
	);
}

/** "acme/app#7" for a GitHub pull request's address. */
function pullRequestName(url: string): string {
	const match = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
	return match ? `${match[1]}#${match[2]}` : url;
}
