/** The Output section of a node whose data has an optional shape: a Command, a Tool or a Web request. */
import {
	type CommandNode,
	type ToolNode,
	type WebRequestNode,
	withOutputSchema,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { useId } from "react";
import { InspectorSection } from "../fields";
import { OutputSchemaField } from "../output-schema-field";

/**
 * The shape of a step's data, on the Results tab. Optional: without one,
 * the first run that gives data sets it, marked as inferred. A shape that
 * you write or confirm fails the step when the data does not fit.
 */
export function DataShapeSection<
	T extends CommandNode | ToolNode | WebRequestNode,
>({
	node,
	onChange,
	label = "Data shape",
}: {
	node: T;
	onChange: (change: (node: T) => T) => void;
	/** What the shape is of: the data, or the body of an answer. */
	label?: string;
}) {
	const id = useId();
	const inferred = node.outputInferred === true;
	return (
		<InspectorSection
			title="Output"
			tab="results"
			defaultOpen={node.output !== undefined}
			aside={
				node.output !== undefined ? (
					<Badge variant={inferred ? "outline" : "secondary"}>
						{inferred ? "inferred" : "shape"}
					</Badge>
				) : null
			}
		>
			<OutputSchemaField
				id={`${id}-output`}
				nodeId={node.id}
				label={label}
				output={node.output}
				assist
				description="Leave it empty, and Night Shift takes it from the first run. A shape you set fails the step when the data does not fit."
				inferred={inferred}
				onConfirm={() =>
					onChange((current) => withOutputSchema(current, current.output))
				}
				onChange={(output) =>
					onChange((current) => withOutputSchema(current, output))
				}
			/>
		</InspectorSection>
	);
}
