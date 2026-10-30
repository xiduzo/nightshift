/** The fields of an End node: how it ends the run, and the line it leaves for you. */
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
						<ToggleGroupItem
							key={status}
							value={status}
							className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
						>
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
				placeholder="No open issues for {{label}}"
				multiline={false}
				onChange={(message) =>
					onChange(({ message: _, ...current }) =>
						message === "" ? current : { ...current, message },
					)
				}
			/>
			<Note>
				No edge leaves this node. In a subflow, it ends only the subflow. The
				Subflow node reads the result as <code>ended</code> and the message as{" "}
				<code>end_message</code>.
			</Note>
		</InspectorSection>
	);
}
