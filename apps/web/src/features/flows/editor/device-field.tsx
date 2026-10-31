import type { FlowNode } from "@nightshift/flows";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";

import { missingDeviceMessage } from "../flow-draft";
import { Field } from "./fields";

/**
 * A device a node can name, as the Host lists it: one of yours, or
 * another person's with the profiles it offers to the Space (`offers`).
 */
export type DeviceChoice = {
	name: string;
	thisDevice: boolean;
	offers?: string[];
};

/**
 * The node types whose step runs on a device; a Decision and a Value only
 * when a model decides. A Subflow names where the steps of its flow run.
 */
export function runsOnDevice(node: FlowNode): boolean {
	switch (node.type) {
		case "agent":
		case "command":
		case "tool":
		case "call":
		case "service":
			return true;
		case "decision":
		case "value":
			return node.by === "model";
		default:
			return false;
	}
}

/** The node with its step on `device`, or on the run's device when undefined. */
export function withDevice(
	node: FlowNode,
	device: string | undefined,
): FlowNode {
	if (!runsOnDevice(node)) return node;
	const { device: _previous, ...rest } = node as FlowNode & {
		device?: string;
	};
	return (device === undefined ? rest : { ...rest, device }) as FlowNode;
}

const RUN_DEVICE = "__run__";

/** The words of a `DeviceField`: a step's device, or where a Subflow runs. */
export type DeviceFieldCopy = {
	label: string;
	hint: string;
	/** The choice for no device of its own. */
	run: string;
	/** The error for a name the list does not have. */
	unknown: (name: string) => string;
};

const STEP_COPY: DeviceFieldCopy = {
	label: "Device",
	hint: "Pick one of your devices, or a device that someone offers for this profile.",
	run: "The device the run starts on",
	unknown: (name) => missingDeviceMessage(name, { type: "command" }),
};

/** A Subflow's words: its steps run on the computer it names. */
export const SUBFLOW_DEVICE_COPY: DeviceFieldCopy = {
	label: "Runs on",
	hint: "The steps of this Subflow run on the computer you pick, wherever the run runs. Pick one with the folder or tools they need.",
	run: "Where the run runs",
	unknown: (name) => missingDeviceMessage(name, { type: "call" }),
};

/**
 * Where a step runs: one of your devices by name, or the device the run
 * starts on. The list is what the Host says this node may name: yours,
 * and other people's that offer the node's profile to the Space. A name
 * that is not one of them stays, marked as an error, so a flow from a
 * colleague keeps its choice until you pick another.
 */
export function DeviceField({
	id,
	value,
	devices,
	copy = STEP_COPY,
	onChange,
}: {
	id: string;
	value: string | undefined;
	/** The devices this node may name (`runs.devices` with `forNode`); undefined while they load. */
	devices: readonly DeviceChoice[] | undefined;
	copy?: DeviceFieldCopy;
	onChange: (device: string | undefined) => void;
}) {
	const listed = devices ?? [];
	const names = [...new Set(listed.map((d) => d.name))];
	const unknown = value !== undefined && !names.includes(value);
	const label = (name: string) => {
		const known = listed.find((d) => d.name === name);
		if (!known) return `${name} (not found)`;
		if (known.offers !== undefined && !known.thisDevice) {
			return `${name} (offers ${known.offers.join(", ")})`;
		}
		return known.thisDevice ? `${name} (this computer)` : name;
	};
	const items = [
		{ value: RUN_DEVICE, label: copy.run },
		...(unknown ? [{ value, label: label(value) }] : []),
		...names.map((name) => ({ value: name, label: label(name) })),
	];
	return (
		<Field
			id={id}
			label={copy.label}
			optional
			hint={copy.hint}
			// Only once the list is in: a name it lacks does not run.
			error={unknown && devices !== undefined ? copy.unknown(value) : null}
		>
			<Select
				items={items}
				value={value ?? RUN_DEVICE}
				onValueChange={(next) => {
					if (next === null) return;
					onChange(next === RUN_DEVICE ? undefined : next);
				}}
			>
				<SelectTrigger
					id={id}
					className="w-full"
					aria-describedby={`${id}-hint`}
					aria-invalid={(unknown && devices !== undefined) || undefined}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{items.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</Field>
	);
}
