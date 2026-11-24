/** The fields of an End node: how it ends the run, the line it leaves for you, and its report. */
import type { EndNode, EndStatus, Flow } from "@nightshift/flows";
import { useId } from "react";
import { END_STATUS_LABEL } from "../../canvas";
import {
	type Choice,
	ChoiceField,
	InspectorSection,
	Note,
	withOptional,
} from "./form";
import { TemplateField } from "./template";

/** The results, in the order the toggle shows them. */
const STATUSES = (["done", "nothing-to-do", "failed"] as const).map(
	(value) => ({ value, label: END_STATUS_LABEL[value] }),
);

const STATUS_HINT: Record<EndStatus, string> = {
	done: "The run did its work.",
	"nothing-to-do": "The run found no work. This is not a failure.",
	failed: "The run fails here on purpose. You can run it again from a step.",
};

/** Whether the node writes a report, or reads one, in the order the toggle shows them. */
type ReportKind = "none" | NonNullable<EndNode["report"]>["kind"];

const REPORT_KINDS: Choice<ReportKind>[] = [
	{ value: "none", label: "None" },
	{ value: "text", label: "Write it" },
	{ value: "file", label: "A file the run wrote" },
];

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
		onChange((current) => withOptional(current, "report", next));
	return (
		<InspectorSection title="End">
			<ChoiceField
				id={`${id}-status`}
				label="Result"
				hint={STATUS_HINT[node.status]}
				value={node.status}
				choices={STATUSES}
				onChange={(status) => onChange((current) => ({ ...current, status }))}
			/>
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
					onChange((current) =>
						withOptional(
							current,
							"message",
							message === "" ? undefined : message,
						),
					)
				}
			/>
			<ChoiceField
				id={`${id}-report-kind`}
				label="Report"
				hint="Shows on the run page, on the flow's card and on Home."
				value={report?.kind ?? "none"}
				choices={REPORT_KINDS}
				onChange={(kind) => {
					if (kind === "none") setReport(undefined);
					if (kind === "text") setReport({ kind: "text", text: "" });
					if (kind === "file") setReport({ kind: "file", path: "" });
				}}
			/>
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
