/** The fields of a Convert node: what it converts, the value, and the shape of its data. */
import {
	CONVERT_FORMAT_LABEL,
	CONVERT_PAIRS,
	type ConvertFormat,
	type ConvertNode,
	DEFAULT_CONVERT_MAX_BYTES,
	type Flow,
	MAX_CONVERT_BYTES,
	withOutputSchema,
} from "@nightshift/flows";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { useId } from "react";
import { Field, InspectorSection, Note, PositiveIntInput } from "../fields";
import { OutputSchemaField } from "../output-schema-field";
import { TemplateField } from "../template-field";

const MB = 1024 * 1024;

/** A pair as the select's value: `csv>json`. */
const pairKey = (pair: { from: ConvertFormat; to: ConvertFormat }) =>
	`${pair.from}>${pair.to}`;

/** What the value field holds, by the format it reads. */
const VALUE_HINT: Record<ConvertFormat, string> = {
	json: "One reference keeps its value. Other text must be valid JSON.",
	csv: "Text with a header row.",
	yaml: "YAML text.",
	xml: "XML text.",
	feed: "The text of an RSS, Atom or JSON feed.",
	"markdown-table": "Text with a Markdown table. The first table counts.",
	html: "The HTML of a page.",
	text: "Text.",
};

/**
 * The node with a new pair. Only CSV reads a delimiter and only JSON data
 * has an output schema, so another pair drops them.
 */
function withPair(
	node: ConvertNode,
	from: ConvertFormat,
	to: ConvertFormat,
): ConvertNode {
	const { delimiter, output, outputInferred, ...rest } = node;
	const csv = from === "csv" || to === "csv";
	return {
		...rest,
		from,
		to,
		...(csv && delimiter !== undefined ? { delimiter } : {}),
		...(to === "json" && output !== undefined
			? { output, ...(outputInferred ? { outputInferred } : {}) }
			: {}),
	};
}

export function ConvertFields({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: ConvertNode;
	onChange: (change: (node: ConvertNode) => ConvertNode) => void;
}) {
	const id = useId();
	const csv = node.from === "csv" || node.to === "csv";
	const makesData = node.to === "json";
	return (
		<>
			<InspectorSection title="Convert">
				<Field id={`${id}-pair`} label="Convert">
					<NativeSelect
						id={`${id}-pair`}
						className="w-full"
						value={pairKey(node)}
						onChange={(event) => {
							const pair = CONVERT_PAIRS.find(
								(candidate) => pairKey(candidate) === event.target.value,
							);
							if (pair) {
								onChange((current) => withPair(current, pair.from, pair.to));
							}
						}}
					>
						{CONVERT_PAIRS.map((pair) => (
							<NativeSelectOption key={pairKey(pair)} value={pairKey(pair)}>
								{CONVERT_FORMAT_LABEL[pair.from]} to{" "}
								{CONVERT_FORMAT_LABEL[pair.to]}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>
				<TemplateField
					id={`${id}-value`}
					label="Value"
					hint={VALUE_HINT[node.from]}
					flow={flow}
					nodeId={node.id}
					value={node.value}
					placeholder="{{fetch.body}}"
					invalid={node.value.trim() === ""}
					onChange={(value) => onChange((current) => ({ ...current, value }))}
				/>
				{csv ? (
					<Field
						id={`${id}-delimiter`}
						label="Delimiter"
						optional
						hint={
							node.from === "csv"
								? "The character between fields. Empty: Night Shift finds it."
								: "The character between fields. Empty: a comma."
						}
					>
						<Input
							id={`${id}-delimiter`}
							className="w-16 font-mono"
							maxLength={1}
							value={node.delimiter ?? ""}
							placeholder={node.from === "csv" ? "" : ","}
							aria-describedby={`${id}-delimiter-hint`}
							onChange={(event) => {
								const delimiter = event.target.value;
								onChange(({ delimiter: _, ...current }) =>
									delimiter === "" ? current : { ...current, delimiter },
								);
							}}
						/>
					</Field>
				) : null}
				<Note>
					{makesData ? (
						<>
							Later nodes read the data as <code>{`{{${node.id}.data}}`}</code>{" "}
							or a path into it
						</>
					) : (
						<>
							Later nodes read the text as <code>{`{{${node.id}.text}}`}</code>
						</>
					)}
					, and why it failed as <code>{`{{${node.id}.note}}`}</code>.
				</Note>
			</InspectorSection>

			{makesData ? (
				<InspectorSection title="Output" tab="results">
					<OutputSchemaField
						id={`${id}-output`}
						nodeId={node.id}
						output={node.output}
						description="Empty: the data has the shape of the format. The step fails when the data does not fit."
						inferred={node.outputInferred === true}
						onConfirm={() =>
							onChange((current) => withOutputSchema(current, current.output))
						}
						onChange={(output) =>
							onChange((current) => withOutputSchema(current, output))
						}
					/>
				</InspectorSection>
			) : null}

			<InspectorSection
				title="Limits"
				tab="setup"
				defaultOpen={node.maxBytes !== undefined}
			>
				<Field
					id={`${id}-size`}
					label="Size limit in MB"
					optional
					hint={`The step fails when the value is bigger. At most ${MAX_CONVERT_BYTES / MB} MB.`}
				>
					<PositiveIntInput
						id={`${id}-size`}
						value={
							node.maxBytes === undefined
								? undefined
								: Math.max(1, Math.round(node.maxBytes / MB))
						}
						placeholder={String(DEFAULT_CONVERT_MAX_BYTES / MB)}
						describedBy={`${id}-size-hint`}
						onChange={(megabytes) =>
							onChange(({ maxBytes: _, ...current }) =>
								megabytes === undefined
									? current
									: {
											...current,
											maxBytes: Math.min(megabytes * MB, MAX_CONVERT_BYTES),
										},
							)
						}
					/>
				</Field>
			</InspectorSection>
		</>
	);
}
