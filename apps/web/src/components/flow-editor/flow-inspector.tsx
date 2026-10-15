import type { Flow } from "@nightshift/flows";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Textarea } from "@nightshift/ui/components/textarea";
import { useId } from "react";

import { Field } from "./fields";

/** Shown when nothing is selected: the flow's own settings and how to edit. */
export function FlowInspector({
	flow,
	onChange,
}: {
	flow: Flow;
	onChange: (change: (flow: Flow) => Flow) => void;
}) {
	const id = useId();
	return (
		<div className="flex flex-col gap-4">
			<h2 className="font-medium text-sm">Flow</h2>
			<Field id={`${id}-description`} label="Description" optional>
				<Textarea
					id={`${id}-description`}
					value={flow.description ?? ""}
					placeholder="What this flow does, in one line."
					onChange={(event) => {
						const description = event.target.value;
						onChange((current) => ({
							...current,
							description: description || undefined,
						}));
					}}
				/>
			</Field>
			<Field id={`${id}-start`} label="Start node" hint="The run starts here.">
				<NativeSelect
					id={`${id}-start`}
					value={flow.start}
					aria-invalid={!flow.nodes.some((node) => node.id === flow.start)}
					onChange={(event) => {
						const start = event.target.value;
						onChange((current) => ({ ...current, start }));
					}}
				>
					{flow.nodes.some((node) => node.id === flow.start) ? null : (
						<NativeSelectOption value={flow.start}>
							Pick a node
						</NativeSelectOption>
					)}
					{flow.nodes.map((node) => (
						<NativeSelectOption key={node.id} value={node.id}>
							{node.label ? `${node.label} (${node.id})` : node.id}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</Field>
			<section aria-labelledby={`${id}-help`} className="flex flex-col gap-1.5">
				<h3 id={`${id}-help`} className="font-medium text-xs">
					How to edit
				</h3>
				<ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground text-xs">
					<li>Add a node with the buttons on the canvas.</li>
					<li>
						Drag from an outcome dot on the right of a node to another node to
						add an edge.
					</li>
					<li>Select a node or an edge to edit it. Backspace deletes it.</li>
					<li>
						An edge back to an earlier node is a retry loop. Give one edge in
						every loop a max.
					</li>
					<li>⌘/Ctrl + S saves.</li>
				</ul>
			</section>
		</div>
	);
}
