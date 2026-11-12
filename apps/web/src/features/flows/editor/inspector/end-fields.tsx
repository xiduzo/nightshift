/** The fields of an End node: how it ends the run, the line it leaves for you, and its report. */
import type { EndNode, EndStatus, Flow } from "@nightshift/flows";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useId } from "react";
import { END_STATUS_LABEL } from "../../canvas/node-type";
import { Field, InspectorSection, Note } from "../fields";
import { TemplateField } from "../template-field";

/** The results, in the order the toggle shows them. */
const STATUSES: EndStatus[] = ["done", "nothing-to-do", "failed"];

const STATUS_HINT: Record<EndStatus, string> = {
	done: "The run did its work.",
	"nothing-to-do": "The run found no work. This is not a failure.",
	failed: "The run fails here on purpose. You can run it again from a step.",
};

/** Whether the node writes a report, or reads one, in the order the toggle shows them. */
type ReportKind = "none" | NonNullable<EndNode["report"]>["kind"];

const REPORT_KINDS: { kind: ReportKind; label: string }[] = [
	{ kind: "none", label: "None" },
	{ kind: "text", label: "Write it" },
	{ kind: "file", label: "A file the run wrote" },
];

const PRESSED =
	"flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground";

export function EndFields({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: EndNode;
	onChange: (change: (node: EndNode) => EndNode) => void;
}) {
	const id = useId();
	const { report } = node;
	const setReport = (next: EndNode["report"]) =>
		onChange(({ report: _, ...current }) =>
			next ? { ...current, report: next } : current,
		);
	return (
		<InspectorSection title="End">
			<Field id={`${id}-status`} label="Result" hint={STATUS_HINT[node.status]}>
				<ToggleGroup
					variant="outline"
					size="sm"
					spacing={0}
					aria-label="Result"
					className="w-full"
					value={[node.status]}
					onValueChange={(value) => {
						const status = value[0] as EndStatus | undefined;
						if (status) onChange((current) => ({ ...current, status }));
					}}
				>
					{STATUSES.map((status) => (
						<ToggleGroupItem key={status} value={status} className={PRESSED}>
							{END_STATUS_LABEL[status]}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</Field>
			<TemplateField
				id={`${id}-message`}
				label="Message"
				hint="One line for you in the runs list and the notification."
				flow={flow}
				nodeId={node.id}
				value={node.message ?? ""}
				placeholder="Nothing new about {{topic}}"
				multiline={false}
				onChange={(message) =>
					onChange(({ message: _, ...current }) =>
						message === "" ? current : { ...current, message },
					)
				}
			/>
			<Field
				id={`${id}-report-kind`}
				label="Report"
				hint="Shows on the run page, on the flow's card and on Home."
			>
				<ToggleGroup
					variant="outline"
					size="sm"
					spacing={0}
					aria-label="Report"
					className="w-full"
					value={[report?.kind ?? "none"]}
					onValueChange={(value) => {
						const kind = value[0] as ReportKind | undefined;
						if (kind === "none") setReport(undefined);
						if (kind === "text") setReport({ kind: "text", text: "" });
						if (kind === "file") setReport({ kind: "file", path: "" });
					}}
				>
					{REPORT_KINDS.map(({ kind, label }) => (
						<ToggleGroupItem key={kind} value={kind} className={PRESSED}>
							{label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</Field>
			{report?.kind === "text" ? (
				<TemplateField
					id={`${id}-report`}
					label="Text"
					flow={flow}
					nodeId={node.id}
					value={report.text}
					placeholder={"## What is new\n\n{{summary.output}}"}
					language="markdown"
					onChange={(text) => setReport({ kind: "text", text })}
				/>
			) : null}
			{report?.kind === "file" ? (
				<TemplateField
					id={`${id}-report-file`}
					label="File"
					hint="A path inside the folder the run works in."
					flow={flow}
					nodeId={node.id}
					value={report.path}
					placeholder="report.md"
					multiline={false}
					onChange={(path) => setReport({ kind: "file", path })}
				/>
			) : null}
			<Note>
				No edge leaves this node. In a subflow, it ends only the subflow. The
				Subflow node reads the result as <code>ended</code>, the message as{" "}
				<code>end_message</code> and the report as <code>end_report</code>.
			</Note>
		</InspectorSection>
	);
}
