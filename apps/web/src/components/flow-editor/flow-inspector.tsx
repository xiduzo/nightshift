import type { Flow, Policy } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Kbd, KbdGroup } from "@nightshift/ui/components/kbd";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Textarea } from "@nightshift/ui/components/textarea";
import { Link } from "@tanstack/react-router";
import { SettingsIcon, WorkflowIcon } from "lucide-react";
import { useId } from "react";

import { POLICY_DEFAULTS, setPolicyValue } from "@/lib/flow-draft";

import {
	Field,
	InspectorHeader,
	InspectorSection,
	Note,
	PositiveIntInput,
} from "./fields";
import { InputsEditor, OutputsEditor } from "./io-editor";

const POLICY_FIELDS: {
	key: Exclude<keyof Policy, "resumeInterruptedRuns">;
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
	name,
	policyDefaults,
	onChange,
}: {
	flow: Flow;
	/** The flow's file name, for the header. */
	name?: string;
	/** The daemon's run policy settings: what an empty number uses. Undefined while they load. */
	policyDefaults?: Required<Policy>;
	onChange: (change: (flow: Flow) => Flow) => void;
}) {
	const id = useId();
	const policySet = Object.values(flow.policy ?? {}).some(
		(value) => value !== undefined,
	);
	return (
		<div className="flex flex-col">
			<InspectorHeader
				icon={WorkflowIcon}
				kicker="Flow"
				title={name ?? "This flow"}
			/>

			<InspectorSection title="General" collapsible>
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
				<Field
					id={`${id}-start`}
					label="Start node"
					hint="The run starts here."
				>
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
			</InspectorSection>

			<InspectorSection
				title="Inputs"
				collapsible
				defaultOpen={flow.inputs.length > 0}
				aside={
					<Badge variant="secondary" className="tabular-nums">
						{flow.inputs.length}
					</Badge>
				}
				className="gap-3"
			>
				<Note id={`${id}-inputs-hint`}>
					What the flow takes, like a function. A run asks for them when it
					starts; a Subflow or For Each node binds them. Read one as{" "}
					<code>{"{{name}}"}</code>, a JSON one with a path:{" "}
					<code>{"{{item.title}}"}</code>. Renaming one updates the references
					in this flow.
				</Note>
				<InputsEditor
					flow={flow}
					describedBy={`${id}-inputs-hint`}
					onChange={onChange}
				/>
			</InspectorSection>

			<InspectorSection
				title="Outputs"
				collapsible
				defaultOpen={flow.outputs.length > 0}
				aside={
					<Badge variant="secondary" className="tabular-nums">
						{flow.outputs.length}
					</Badge>
				}
				className="gap-3"
			>
				<Note id={`${id}-outputs-hint`}>
					What the flow returns to the node that calls it, rendered when it
					ends. A value that is one reference keeps its JSON:{" "}
					<code>{"{{review.data}}"}</code>.
				</Note>
				<OutputsEditor
					flow={flow}
					describedBy={`${id}-outputs-hint`}
					onChange={onChange}
				/>
			</InspectorSection>

			<InspectorSection
				title="Run policy"
				collapsible
				defaultOpen={policySet}
				description="Used when this flow is the top level of a run; a called flow uses its caller's. A usage limit or a network failure puts the run to sleep, then continues the same session. Empty uses the daemon's setting."
			>
				{POLICY_FIELDS.map(({ key, label, hint, whole }) => (
					<Field key={key} id={`${id}-${key}`} label={label} hint={hint}>
						<PositiveIntInput
							id={`${id}-${key}`}
							decimal={!whole}
							value={flow.policy?.[key]}
							placeholder={
								policyDefaults
									? `${policyDefaults[key]} (from Settings)`
									: `${POLICY_DEFAULTS[key]} (default)`
							}
							describedBy={`${id}-${key}-hint`}
							onChange={(value) =>
								onChange((current) => setPolicyValue(current, key, value))
							}
						/>
					</Field>
				))}
				<Field
					id={`${id}-resume`}
					label="After a daemon restart"
					hint="A run the daemon stopped mid-step continues on its own in the same session, or waits for you. Only with the scheduler on."
				>
					<NativeSelect
						id={`${id}-resume`}
						value={
							flow.policy?.resumeInterruptedRuns === undefined
								? ""
								: flow.policy.resumeInterruptedRuns
									? "on"
									: "off"
						}
						aria-describedby={`${id}-resume-hint`}
						onChange={(event) => {
							const picked = event.target.value;
							onChange((current) =>
								setPolicyValue(
									current,
									"resumeInterruptedRuns",
									picked === "" ? undefined : picked === "on",
								),
							);
						}}
					>
						<NativeSelectOption value="">
							{`${(policyDefaults ?? POLICY_DEFAULTS).resumeInterruptedRuns ? "Resume" : "Wait"} (${policyDefaults ? "from Settings" : "default"})`}
						</NativeSelectOption>
						<NativeSelectOption value="on">
							Resume on its own
						</NativeSelectOption>
						<NativeSelectOption value="off">
							Wait for a person
						</NativeSelectOption>
					</NativeSelect>
				</Field>
				<Button
					variant="link"
					size="sm"
					className="h-auto self-start px-0"
					nativeButton={false}
					render={<Link to="/settings" />}
				>
					<SettingsIcon data-icon="inline-start" />
					Change in Settings
				</Button>
			</InspectorSection>

			<InspectorSection
				title="How to edit"
				collapsible
				defaultOpen={flow.nodes.length <= 1}
			>
				<ul className="flex list-disc flex-col gap-1.5 pl-4 text-muted-foreground text-xs leading-relaxed marker:text-border">
					<li>Add a node with the buttons above the canvas.</li>
					<li>
						Drag from an outcome dot on the right of a node to another node to
						add an edge, or add one from the node's Edges section.
					</li>
					<li>
						Select a node or an edge to edit it. <Kbd>Backspace</Kbd> deletes
						it.
					</li>
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
					<li>
						<KbdGroup>
							<Kbd>⌘</Kbd>
							<Kbd>S</Kbd>
						</KbdGroup>{" "}
						or{" "}
						<KbdGroup>
							<Kbd>Ctrl</Kbd>
							<Kbd>S</Kbd>
						</KbdGroup>{" "}
						saves.
					</li>
				</ul>
			</InspectorSection>
		</div>
	);
}
