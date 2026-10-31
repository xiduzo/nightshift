/** The fields of a Lease node: the lease's name, how long it waits, and until when the run holds it. */
import {
	DEFAULT_LEASE_TTL_MINUTES,
	type Flow,
	type LeaseNode,
	leaseSection,
	nodesWithin,
} from "@nightshift/flows";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { useId } from "react";
import { Field, InspectorSection, Note, PositiveIntInput } from "../fields";
import { TemplateField } from "../template-field";

/** The value of the scope select for the whole run: a Section id is never empty. */
const WHOLE_RUN = "";

export function LeaseFields({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: LeaseNode;
	onChange: (change: (node: LeaseNode) => LeaseNode) => void;
}) {
	const id = useId();
	// The Sections the node is in: the lease can hold until the run leaves one.
	const sections = (flow.sections ?? []).filter((section) =>
		nodesWithin(flow, section).includes(node.id),
	);
	const section = leaseSection(node);
	return (
		<InspectorSection title="Lease">
			<TemplateField
				id={`${id}-name`}
				label="Name"
				hint="One run at a time holds this name. Runs on your other computers take turns too."
				flow={flow}
				nodeId={node.id}
				value={node.name}
				placeholder="branch:{{pr.data.head}}"
				multiline={false}
				invalid={node.name.trim() === ""}
				onChange={(name) => onChange((current) => ({ ...current, name }))}
			/>
			<Field
				id={`${id}-wait`}
				label="Wait for a busy lease (minutes)"
				optional
				hint="Empty: the node ends busy at once when another run holds the lease."
			>
				<PositiveIntInput
					id={`${id}-wait`}
					value={node.waitMinutes || undefined}
					placeholder="0"
					describedBy={`${id}-wait-hint`}
					onChange={(waitMinutes) =>
						onChange(({ waitMinutes: _, ...current }) =>
							waitMinutes === undefined ? current : { ...current, waitMinutes },
						)
					}
				/>
			</Field>
			<Field
				id={`${id}-scope`}
				label="Hold it until"
				hint="Night Shift lets go of the lease then, and when the run ends, however it ends."
			>
				<NativeSelect
					id={`${id}-scope`}
					value={section ?? WHOLE_RUN}
					aria-describedby={`${id}-scope-hint`}
					onChange={(event) => {
						const value = event.target.value;
						onChange(({ scope: _, ...current }) =>
							value === WHOLE_RUN
								? current
								: { ...current, scope: { section: value } },
						);
					}}
				>
					<NativeSelectOption value={WHOLE_RUN}>
						The run ends
					</NativeSelectOption>
					{sections.map((frame) => (
						<NativeSelectOption key={frame.id} value={frame.id}>
							The run leaves {frame.label || frame.id}
						</NativeSelectOption>
					))}
					{section !== null && !sections.some((s) => s.id === section) ? (
						<NativeSelectOption value={section}>
							The run leaves {section} (not found)
						</NativeSelectOption>
					) : null}
				</NativeSelect>
			</Field>
			<Field
				id={`${id}-ttl`}
				label="Free it after a computer is gone for (minutes)"
				optional
				hint="When the computer that runs the run is gone this long, another run can take the lease."
			>
				<PositiveIntInput
					id={`${id}-ttl`}
					value={node.ttlMinutes}
					placeholder={String(DEFAULT_LEASE_TTL_MINUTES)}
					describedBy={`${id}-ttl-hint`}
					onChange={(ttlMinutes) =>
						onChange(({ ttlMinutes: _, ...current }) =>
							ttlMinutes === undefined
								? current
								: // The run renews the lease every minute: 2 is the least.
									{ ...current, ttlMinutes: Math.max(2, ttlMinutes) },
						)
					}
				/>
			</Field>
			<Note>
				Draw a <code>busy</code> edge, for example to an End node with nothing
				to do. Without one, a busy lease fails the run. <code>holder</code> and{" "}
				<code>holder_title</code> name the run that holds it.
			</Note>
		</InspectorSection>
	);
}
