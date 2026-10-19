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

/** One of your devices, by the name a node gives it. */
export type DeviceChoice = { name: string; thisDevice: boolean };

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
	onChange,
}: {
	id: string;
	value: string | undefined;
	/** Your devices; undefined while they load. */
	devices: readonly DeviceChoice[] | undefined;
	onChange: (device: string | undefined) => void;
}) {
	const names = [...new Set((devices ?? []).map((d) => d.name))];
	const unknown = value !== undefined && !names.includes(value);
	const label = (name: string) => {
		const own = devices?.find((d) => d.name === name);
		if (!own) return `${name} (not one of your devices)`;
		return own.thisDevice ? `${name} (this computer)` : name;
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
			hint="Pick one of your devices, for example the one with the tools this step needs."
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
