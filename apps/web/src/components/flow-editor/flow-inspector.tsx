import type { Flow, Policy } from "@nightshift/flows";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Textarea } from "@nightshift/ui/components/textarea";
import { useId } from "react";

import { POLICY_DEFAULTS, setPolicyNumber } from "@/lib/flow-draft";

import { Field, PositiveIntInput } from "./fields";
import { InputsEditor, OutputsEditor } from "./io-editor";

const POLICY_FIELDS: {
	key: keyof Policy;
	label: string;
	hint: string;
	whole?: boolean;
}[] = [
	{
		key: "usageLimitFirstWaitMinutes",
		label: "Usage limit: first wait (minutes)",
		hint: "When the harness hits a usage limit without a reset time. Doubles each time.",
	},
	{
		key: "usageLimitMaxWaitMinutes",
		label: "Usage limit: longest wait (minutes)",
		hint: "The doubling stops here.",
	},
	{
		key: "networkGraceMinutes",
		label: "Network grace (minutes)",
		hint: "The longest total wait for the network before the step fails.",
	},
	{
		key: "maxSteps",
		label: "Max steps",
		hint: "A safety net: the run stops (resumable) after this many steps.",
		whole: true,
	},
];

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

			<section aria-labelledby={`${id}-inputs`} className="flex flex-col gap-3">
				<div className="flex flex-col gap-0.5">
					<h3 id={`${id}-inputs`} className="font-medium text-xs">
						Inputs
					</h3>
					<p id={`${id}-inputs-hint`} className="text-muted-foreground text-xs">
						What the flow takes, like a function. A run asks for them when it
						starts; a Subflow or For Each node binds them. Read one as{" "}
						<code className="font-mono">{"{{name}}"}</code>, a JSON one with a
						path: <code className="font-mono">{"{{item.title}}"}</code>.
						Renaming one updates the references in this flow.
					</p>
				</div>
				<InputsEditor
					flow={flow}
					describedBy={`${id}-inputs-hint`}
					onChange={onChange}
				/>
			</section>

			<section
				aria-labelledby={`${id}-outputs`}
				className="flex flex-col gap-3"
			>
				<div className="flex flex-col gap-0.5">
					<h3 id={`${id}-outputs`} className="font-medium text-xs">
						Outputs
					</h3>
					<p
						id={`${id}-outputs-hint`}
						className="text-muted-foreground text-xs"
					>
						What the flow returns to the node that calls it, rendered when it
						ends. A value that is one reference keeps its JSON:{" "}
						<code className="font-mono">{"{{review.data}}"}</code>.
					</p>
				</div>
				<OutputsEditor
					flow={flow}
					describedBy={`${id}-outputs-hint`}
					onChange={onChange}
				/>
			</section>

			<section aria-labelledby={`${id}-policy`} className="flex flex-col gap-3">
				<div className="flex flex-col gap-0.5">
					<h3 id={`${id}-policy`} className="font-medium text-xs">
						Run policy
					</h3>
					<p className="text-muted-foreground text-xs">
						Used when this flow is the top level of a run; a called flow uses
						its caller's. A usage limit or a network failure puts the run to
						sleep, then continues the same session. Empty uses the default.
					</p>
				</div>
				{POLICY_FIELDS.map(({ key, label, hint, whole }) => (
					<Field key={key} id={`${id}-${key}`} label={label} hint={hint}>
						<PositiveIntInput
							id={`${id}-${key}`}
							decimal={!whole}
							value={flow.policy?.[key]}
							placeholder={`${POLICY_DEFAULTS[key]} (default)`}
							describedBy={`${id}-${key}-hint`}
							onChange={(value) =>
								onChange((current) => setPolicyNumber(current, key, value))
							}
						/>
					</Field>
				))}
			</section>
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
						A Decision node has one outcome per label, a Gate node one per
						choice, an Agent node one per own outcome. Renaming one moves its
						edges along.
					</li>
					<li>
						A Subflow node calls another flow once; a For Each node calls one
						per element of a list.
					</li>
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
