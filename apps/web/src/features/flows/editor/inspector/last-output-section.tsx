/**
 * The Last output section of a node, on the Results tab: what the node
 * gave in the newest run of the flow that reached it, field by field. In
 * the editor it also pins that output or skips the node in a test run,
 * the keyboard path to the node's menu on the canvas. A pinned node shows
 * its pinned output instead.
 */
import { type NodeSample, pinProblem } from "@nightshift/client";
import {
	type Flow,
	type FlowNode,
	type JsonValue,
	mainOutputField,
	outcomeColor,
	outputFieldShape,
	standInOutcomes,
	standsIn,
} from "@nightshift/flows";
import { Alert, AlertDescription } from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";
import { Link } from "@tanstack/react-router";
import {
	ArrowUpRightIcon,
	PinIcon,
	PinOffIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useContext, useId, useMemo } from "react";
import { CodeView, formatJson } from "@/shared/code";
import { formatDateTime } from "@/shared/format";
import { OutcomeBadge, outcomeLabel } from "../../canvas/outcome-badge";
import { shapeLabel } from "../../canvas/viewer/gist";
import { NodeSamplesContext } from "../../canvas/viewer/node-samples-context";
import { Field, InspectorSection, Note } from "../fields";
import { useProjectFlowMap } from "../project-flows-context";
import { markOf } from "../test-run/marks";
import {
	type TestMarksApi,
	TestMarksContext,
} from "../test-run/use-test-marks";

/** The most characters of one field the section shows. The run page shows all. */
const SHOWN_MAX = 16_000;

/** The Skip field's choice for a node that runs. */
const RUNS = "__runs__";

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
 * What the node gave in the flow's newest runs, or its pinned output.
 * Hidden while the flow has no run, unless a test run can skip the node.
 * A node those runs did not reach says so.
 */
export function LastOutputSection({ node }: { node: FlowNode }) {
	const samples = useContext(NodeSamplesContext);
	const test = useContext(TestMarksContext);
	const marks = test !== null && standsIn(node) ? test : null;
	if (samples === null && marks === null) return null;
	const mark = marks ? markOf(marks.marks, node.id) : null;
	const pinned = mark?.kind === "pinned";
	const last = samples?.get(node.id);
	const sample = pinned ? marks?.pinned.get(node.id) : last;
	return (
		<InspectorSection
			title={pinned ? "Pinned output" : "Last output"}
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
			{pinned && sample === undefined ? (
				<Note>
					{marks?.pinsLoading
						? "Loading the pinned output…"
						: "Night Shift cannot find the pinned output. Unpin it, or pin a newer output."}
				</Note>
			) : samples === null && !pinned ? (
				<Note>The flow has not run yet.</Note>
			) : sample === undefined ? (
				<Note>The last run did not reach this node.</Note>
			) : (
				<SampleView node={node} sample={sample} />
			)}
			{marks ? (
				<TestFields node={node} last={last} test={marks} pinned={pinned} />
			) : null}
		</InspectorSection>
	);
}

/** Pin the output, or skip the node, in a test run. */
function TestFields({
	node,
	last,
	test,
	pinned,
}: {
	node: FlowNode;
	/** What the node gave in the runs the canvas shows. */
	last: NodeSample | undefined;
	test: TestMarksApi;
	pinned: boolean;
}) {
	const id = useId();
	const mark = markOf(test.marks, node.id);
	const outcomes = standInOutcomes(node);
	const problem = pinProblem(node, last);
	const items = [
		{ value: RUNS, label: "Do not skip" },
		...outcomes.map((outcome) => ({
			value: outcome,
			label: outcomeLabel(outcome),
		})),
	];
	let pinButton: ReactNode = null;
	if (pinned) {
		pinButton = (
			<Button
				variant="outline"
				size="sm"
				className="self-start"
				onClick={() => test.unmark(node.id)}
			>
				<PinOffIcon data-icon="inline-start" />
				Unpin output
			</Button>
		);
	} else if (last !== undefined) {
		pinButton = (
			<div className="flex flex-col gap-1.5">
				<Button
					variant="outline"
					size="sm"
					className="self-start"
					disabled={problem !== null}
					title="A test run gives this output and does not run the node."
					onClick={() =>
						test.pin(node.id, { runId: last.runId, stepId: last.stepId })
					}
				>
					<PinIcon data-icon="inline-start" />
					Pin output
				</Button>
				{/* A step that runs says so above. */}
				{problem !== null && last.endedAt !== null ? (
					<p className="text-muted-foreground text-xs">{problem}</p>
				) : null}
			</div>
		);
	}
	return (
		<>
			{pinButton}
			<Field
				id={`${id}-skip`}
				label="Skip with outcome"
				hint="In a test run, the node does no work and gives this outcome."
			>
				<Select
					items={items}
					value={mark?.kind === "skipped" ? mark.outcome : RUNS}
					onValueChange={(next) => {
						if (next === null) return;
						if (next === RUNS) {
							if (mark?.kind === "skipped") test.unmark(node.id);
						} else test.skip(node.id, next);
					}}
					disabled={outcomes.length === 0}
				>
					<SelectTrigger
						id={`${id}-skip`}
						className="w-full"
						aria-describedby={`${id}-skip-hint`}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{items.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</Field>
		</>
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
