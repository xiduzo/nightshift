import type { Flow, Policy } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Checkbox } from "@nightshift/ui/components/checkbox";
import { Label } from "@nightshift/ui/components/label";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Textarea } from "@nightshift/ui/components/textarea";
import { useId } from "react";

import { POLICY_DEFAULTS, setParams, setPolicyNumber } from "@/lib/flow-draft";

import { Field, PositiveIntInput } from "./fields";
import { ParamsEditor } from "./params-editor";

const POLICY_FIELDS: { key: keyof Policy; label: string; hint: string }[] = [
	{
		key: "usageLimitFirstWaitMinutes",
		label: "Usage limit: first wait",
		hint: "When the harness hits a usage limit without a reset time. Doubles each time.",
	},
	{
		key: "usageLimitMaxWaitMinutes",
		label: "Usage limit: longest wait",
		hint: "The doubling stops here.",
	},
	{
		key: "networkGraceMinutes",
		label: "Network grace",
		hint: "The longest total wait for the network before the step fails.",
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
			<div className="flex items-start gap-2">
				<Checkbox
					id={`${id}-body`}
					checked={flow.input === "item"}
					className="mt-0.5"
					aria-describedby={`${id}-body-hint`}
					onCheckedChange={(checked) =>
						onChange((current) => ({
							...current,
							input: checked ? "item" : undefined,
						}))
					}
				/>
				<div className="flex flex-col gap-0.5">
					<Label htmlFor={`${id}-body`}>Body flow (runs once per item)</Label>
					<p id={`${id}-body-hint`} className="text-muted-foreground text-xs">
						A For Each node runs it for each item. Its templates read the item
						as <code className="font-mono">{"{{item.title}}"}</code>,{" "}
						<code className="font-mono">{"{{item.body}}"}</code>,{" "}
						<code className="font-mono">{"{{item.number}}"}</code>, … and the
						run parameters of the top-level flow as{" "}
						<code className="font-mono">{"{{params.<name>}}"}</code>. A body
						flow does not start on its own.
					</p>
				</div>
			</div>
			{flow.input === "item" ? (
				(flow.params?.length ?? 0) > 0 ? (
					<div className="flex flex-col items-start gap-1.5 border border-destructive/50 bg-destructive/10 px-2 py-1.5 text-xs">
						<p>
							This flow still declares run parameters. A body flow cannot: it
							reads those of the top-level flow.
						</p>
						<Button
							variant="outline"
							size="xs"
							onClick={() => onChange((current) => setParams(current, []))}
						>
							Remove the parameters
						</Button>
					</div>
				) : null
			) : (
				<section
					aria-labelledby={`${id}-params`}
					className="flex flex-col gap-3"
				>
					<div className="flex flex-col gap-0.5">
						<h3 id={`${id}-params`} className="font-medium text-xs">
							Run parameters
						</h3>
						<p
							id={`${id}-params-hint`}
							className="text-muted-foreground text-xs"
						>
							Asked when you start a run. Read them as{" "}
							<code className="font-mono">{"{{params.name}}"}</code>.
						</p>
					</div>
					<ParamsEditor
						flow={flow}
						describedBy={`${id}-params-hint`}
						onChange={onChange}
					/>
				</section>
			)}
			<section aria-labelledby={`${id}-policy`} className="flex flex-col gap-3">
				<div className="flex flex-col gap-0.5">
					<h3 id={`${id}-policy`} className="font-medium text-xs">
						Run policy · minutes
					</h3>
					<p className="text-muted-foreground text-xs">
						{flow.input === "item"
							? "A body flow uses the run policy of the flow that runs it."
							: "A usage limit or a network failure puts the run to sleep, then continues the same session. Empty uses the default."}
					</p>
				</div>
				{(flow.input === "item" ? [] : POLICY_FIELDS).map(
					({ key, label, hint }) => (
						<Field key={key} id={`${id}-${key}`} label={label} hint={hint}>
							<PositiveIntInput
								id={`${id}-${key}`}
								decimal
								value={flow.policy?.[key]}
								placeholder={`${POLICY_DEFAULTS[key]} (default)`}
								describedBy={`${id}-${key}-hint`}
								onChange={(value) =>
									onChange((current) => setPolicyNumber(current, key, value))
								}
							/>
						</Field>
					),
				)}
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
						choice. Renaming one moves its edges along.
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
