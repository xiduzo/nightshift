import type { JoinNode, JoinWait } from "@nightshift/flows";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { useId } from "react";
import { Field, InspectorSection } from "../fields";

const WAIT_ORDER: JoinWait[] = ["all", "first"];

const WAIT_LABEL: Record<JoinWait, string> = {
	all: "Every branch is done",
	first: "The first branch is done",
};

const WAIT_HINT: Record<JoinWait, string> = {
	all: "The run continues with the results of every branch.",
	first:
		"The run continues with the first result. Night Shift stops the other branches.",
};

/**
 * When a Join goes on. Its branches are the edges that leave one node on
 * one outcome without a max: the canvas marks them "at once".
 */
export function JoinFields({
	node,
	onChange,
}: {
	node: JoinNode;
	onChange: (change: (node: JoinNode) => JoinNode) => void;
}) {
	const id = useId();
	return (
		<InspectorSection title="Join">
			<Field
				id={`${id}-wait`}
				label="Continue when"
				hint={WAIT_HINT[node.wait]}
			>
				<NativeSelect
					id={`${id}-wait`}
					value={node.wait}
					aria-describedby={`${id}-wait-hint`}
					onChange={(event) => {
						const wait = event.target.value as JoinWait;
						onChange((current) => ({ ...current, wait }));
					}}
				>
					{WAIT_ORDER.map((wait) => (
						<NativeSelectOption key={wait} value={wait}>
							{WAIT_LABEL[wait]}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</Field>
		</InspectorSection>
	);
}
