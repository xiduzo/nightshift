/** The flow's outputs: what a run gives back when it ends. */
import {
	type Flow,
	type FlowOutputDef,
	setOutputs,
	uniqueOutputName,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import { Item } from "@nightshift/ui/components/item";
import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { TemplateField } from "../template-field";
import { type Change, move, NameInput, RowButtons } from "./io-rows";

/** Fields a Call node has on its own; an output may not shadow them. */
const RESERVED_OUTPUTS = ["outcome", "ended", "visit"];

/**
 * The flow's outputs: values it returns to the Call node that calls
 * it, rendered from templates when the flow ends.
 */
export function OutputsEditor({
	flow,
	describedBy,
	onChange,
}: {
	flow: Flow;
	describedBy?: string;
	onChange: Change;
}) {
	const id = useId();
	const [focusIndex, setFocusIndex] = useState<number | null>(null);
	const outputs = flow.outputs;

	const update = (
		index: number,
		change: (output: FlowOutputDef) => FlowOutputDef,
	) =>
		onChange((current) =>
			setOutputs(
				current,
				current.outputs.map((output, at) =>
					at === index ? change(output) : output,
				),
			),
		);

	return (
		<div className="flex flex-col gap-2">
			{outputs.length > 0 ? (
				<ol className="flex flex-col gap-1.5" aria-describedby={describedBy}>
					{outputs.map((output, index) => {
						const rowId = `${id}-${index}`;
						const position = `output ${index + 1}`;
						return (
							<Item
								render={<li />}
								// Outputs have no ids; the row follows its place in the list.
								key={index}
								variant="outline"
								size="xs"
								className="flex-col items-stretch gap-1.5 bg-card"
							>
								<NameInput
									id={`${rowId}-name`}
									name={output.name}
									label={`Name of ${position}`}
									autoFocus={focusIndex === index}
									onCommit={(name) => {
										if (RESERVED_OUTPUTS.includes(name))
											return `The name ${name} is taken. Pick another name.`;
										if (
											outputs.some(
												(other, at) => at !== index && other.name === name,
											)
										)
											return `Another output is named ${name}.`;
										update(index, (current) => ({ ...current, name }));
										return null;
									}}
								>
									<RowButtons
										name={output.name}
										noun="output"
										index={index}
										count={outputs.length}
										onMove={(to) =>
											onChange((current) =>
												setOutputs(current, move(current.outputs, index, to)),
											)
										}
										onRemove={() =>
											onChange((current) =>
												setOutputs(
													current,
													current.outputs.filter((_, at) => at !== index),
												),
											)
										}
									/>
								</NameInput>
								<TemplateField
									id={`${rowId}-value`}
									label="Value"
									flow={flow}
									nodeId={null}
									value={output.value}
									multiline={false}
									variablesOpen={false}
									placeholder="{{review.data}}"
									onChange={(value) =>
										update(index, (current) => ({ ...current, value }))
									}
								/>
								<Input
									id={`${rowId}-description`}
									value={output.description ?? ""}
									aria-label={`Description of ${position}`}
									placeholder="What it holds (optional)"
									className="h-8 text-xs"
									autoComplete="off"
									onChange={(event) => {
										const description = event.target.value;
										update(index, ({ description: _, ...rest }) =>
											description === "" ? rest : { ...rest, description },
										);
									}}
								/>
							</Item>
						);
					})}
				</ol>
			) : null}
			<Button
				variant="outline"
				size="sm"
				className="self-start"
				onClick={() => {
					setFocusIndex(outputs.length);
					onChange((current) =>
						setOutputs(current, [
							...current.outputs,
							{ name: uniqueOutputName(current, "result"), value: "" },
						]),
					);
				}}
			>
				<PlusIcon data-icon="inline-start" />
				Add output
			</Button>
		</div>
	);
}
