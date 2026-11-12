/**
 * The Last output section of a node, on the Results tab: what the node
 * gave in the newest run of the flow that reached it, field by field.
 */
import type { NodeSample } from "@nightshift/client";
import {
	type Flow,
	type FlowNode,
	type JsonValue,
	mainOutputField,
	outcomeColor,
	outputFieldShape,
} from "@nightshift/flows";
import { Alert, AlertDescription } from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Link } from "@tanstack/react-router";
import { ArrowUpRightIcon, TriangleAlertIcon } from "lucide-react";
import { useContext, useMemo } from "react";
import { CodeView, formatJson } from "@/shared/code";
import { formatDateTime } from "@/shared/format";
import { OutcomeBadge } from "../../canvas/outcome-badge";
import { shapeLabel } from "../../canvas/viewer/gist";
import { NodeSamplesContext } from "../../canvas/viewer/node-samples-context";
import { InspectorSection, Note } from "../fields";
import { useProjectFlowMap } from "../project-flows-context";

/** The most characters of one field the section shows. The run page shows all. */
const SHOWN_MAX = 16_000;

/** One output field as the section shows it. */
type ShownField = {
	field: string;
	shape: string | null;
	code: string;
	language: "json" | "text";
	/** The value is longer than the section shows. */
	cut: boolean;
};

/**
 * What the node gave in the flow's newest runs. Hidden while the flow has
 * no run. A node those runs did not reach says so.
 */
export function LastOutputSection({ node }: { node: FlowNode }) {
	const samples = useContext(NodeSamplesContext);
	if (samples === null) return null;
	const sample = samples.get(node.id);
	return (
		<InspectorSection
			title="Last output"
			tab="results"
			aside={
				sample?.outcome ? (
					<OutcomeBadge
						state={sample.outcome}
						color={outcomeColor(node, sample.outcome)}
					/>
				) : null
			}
		>
			{sample === undefined ? (
				<Note>The last run did not reach this node.</Note>
			) : (
				<SampleView node={node} sample={sample} />
			)}
		</InspectorSection>
	);
}

function SampleView({ node, sample }: { node: FlowNode; sample: NodeSample }) {
	const flows = useProjectFlowMap();
	const called = node.type === "call" ? (flows?.[node.flow] ?? null) : null;
	const fields = useShownFields(node, sample, called);
	const openRun = (
		<Button
			variant="outline"
			size="sm"
			className="self-start"
			nativeButton={false}
			render={
				<Link
					to="/runs/$runId"
					params={{ runId: sample.runId }}
					search={{ step: sample.stepId }}
				/>
			}
		>
			Open the run
			<ArrowUpRightIcon data-icon="inline-end" />
		</Button>
	);
	if (sample.endedAt === null) {
		return (
			<>
				<p className="text-muted-foreground text-xs">
					This node runs now. Its output shows here when it ends.
				</p>
				{openRun}
			</>
		);
	}
	return (
		<>
			<p className="text-muted-foreground text-xs">
				From the run of {formatDateTime(sample.endedAt)}.
			</p>
			{sample.changed ? (
				<Alert className="border-status-waiting/40 text-status-waiting">
					<TriangleAlertIcon />
					<AlertDescription>This node changed after that run.</AlertDescription>
				</Alert>
			) : null}
			{fields.length === 0 ? (
				<Note>The node gave no output in that run.</Note>
			) : (
				fields.map((shown) => (
					<div key={shown.field} className="flex min-w-0 flex-col gap-1.5">
						<div className="flex items-center gap-2">
							<code className="font-mono text-xs">{shown.field}</code>
							{shown.shape ? (
								<Badge variant="outline">{shown.shape}</Badge>
							) : null}
						</div>
						<CodeView
							code={shown.code}
							language={shown.language}
							contentClassName="max-h-48 text-xs"
						/>
						{shown.cut ? (
							<p className="text-muted-foreground text-xs">
								This shows the start only. Open the run to see all of it.
							</p>
						) : null}
					</div>
				))
			)}
			{openRun}
		</>
	);
}

/**
 * The output fields of a sample, the node's main field first. The outcome
 * shows as a badge, so it is left out. The text of each field is made
 * once per sample, not on each edit of the node: an output can be large.
 */
function useShownFields(
	node: FlowNode,
	sample: NodeSample,
	called: Flow | null,
): ShownField[] {
	const texts = useMemo(
		() =>
			Object.entries(sample.outputs)
				.filter(([field]) => field !== "outcome")
				.map(([field, value]) => fieldText(field, value)),
		[sample.outputs],
	);
	const main = mainOutputField(node);
	return [
		...texts.filter((text) => text.field === main),
		...texts.filter((text) => text.field !== main),
	].map((text) => ({
		...text,
		shape: shapeLabel(
			sample.outputs[text.field],
			outputFieldShape(node, text.field, called),
		),
	}));
}

function fieldText(field: string, value: JsonValue): Omit<ShownField, "shape"> {
	const full = formatJson(value);
	const cut = full.length > SHOWN_MAX;
	return {
		field,
		code: cut ? full.slice(0, SHOWN_MAX) : full,
		language: typeof value === "string" ? "text" : "json",
		cut,
	};
}
