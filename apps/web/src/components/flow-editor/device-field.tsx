import type { FlowNode } from "@nightshift/flows";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";

import { Field } from "./fields";

/**
 * A device by the name a node gives it: one of yours, or another
 * person's with the profiles it offers to the Space (`offers`).
 */
export type DeviceChoice = {
	name: string;
	thisDevice: boolean;
	offers?: string[];
};

/**
 * The devices a node can name: yours, and other people's that offer the
 * node's profile to the Space. Only an Agent node with an offered profile
 * runs on another person's device.
 */
export function choicesFor(
	devices: readonly DeviceChoice[],
	profile: string | undefined,
): DeviceChoice[] {
	return devices.filter(
		(d) =>
			d.offers === undefined ||
			(profile !== undefined && d.offers.includes(profile)),
	);
}

/** The node types whose step runs on a device; a Decision and a Value only when a model decides. */
export function runsOnDevice(node: FlowNode): boolean {
	switch (node.type) {
		case "agent":
		case "command":
		case "tool":
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

/**
 * Where a step runs: one of your devices by name, or the device the run
 * starts on. A name that is not one of your devices stays, marked, so a
 * flow from a colleague keeps its choice.
 */
export function DeviceField({
	id,
	value,
	devices,
	profile,
	onChange,
}: {
	id: string;
	value: string | undefined;
	/** Your devices and the ones offered to the Space; undefined while they load. */
	devices: readonly DeviceChoice[] | undefined;
	/** The node's profile: other people's devices that offer it are listed. */
	profile?: string | undefined;
	onChange: (device: string | undefined) => void;
}) {
	const listed = choicesFor(devices ?? [], profile);
	const names = [...new Set(listed.map((d) => d.name))];
	const unknown = value !== undefined && !names.includes(value);
	const label = (name: string) => {
		const known = listed.find((d) => d.name === name);
		if (!known) return `${name} (not one of your devices)`;
		if (known.offers !== undefined && !known.thisDevice) {
			return `${name} (offers ${known.offers.join(", ")})`;
		}
		return known.thisDevice ? `${name} (this computer)` : name;
	};
	const items = [
		{ value: RUN_DEVICE, label: "The device the run starts on" },
		...(unknown ? [{ value, label: label(value) }] : []),
		...names.map((name) => ({ value: name, label: label(name) })),
	];
	return (
		<Field
			id={id}
			label="Device"
			optional
			hint="Pick one of your devices, or a device another person offers this node's profile on."
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
