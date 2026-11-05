import {
	type DeviceRef,
	deviceIdOf,
	type FlowNode,
	legacyDeviceName,
} from "@nightshift/flows";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";

import { missingDeviceMessage, oldDeviceMessage } from "../flow-draft";
import { Field } from "./fields";

/**
 * A device a node can name, as the Host lists it: one of yours, or
 * another person's with the profiles it offers to the Space (`offers`).
 * A node keeps its id; the name is only what the list shows.
 */
export type DeviceChoice = {
	deviceId: string;
	name: string;
	thisDevice: boolean;
	offers?: string[];
	/** A development install: it shows only on itself, or when the node names it. */
	dev?: boolean;
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

/** The node with its step on the device of that id, or on the run's device when undefined. */
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
	/** The error for a device the list does not have. */
	unknown: () => string;
};

const STEP_COPY: DeviceFieldCopy = {
	label: "Device",
	hint: "Pick one of your devices, or a device that someone offers for this profile.",
	run: "The device the run starts on",
	unknown: () => missingDeviceMessage({ type: "command" }),
};

/** A Subflow's words: its steps run on the computer it names. */
export const SUBFLOW_DEVICE_COPY: DeviceFieldCopy = {
	label: "Runs on",
	hint: "The steps of this Subflow run on the computer you pick, wherever the run runs. Pick one with the folder or tools they need.",
	run: "Where the run runs",
	unknown: () => missingDeviceMessage({ type: "call" }),
};

/** The choice that stands for a device name from before ids. */
const OLD_NAME = "__old_name__";

/**
 * Where a step runs: one of your devices, or the device the run starts
 * on. The node keeps the device's id, and the list shows its name. The
 * list is what the Host says this node may name: yours, and other
 * people's that offer the node's profile to the Space. A device that is
 * not one of them stays, marked as an error, so a flow from a colleague
 * keeps its choice until you pick another. So does a name from before
 * ids that Night Shift could not bring to one device.
 */
export function DeviceField({
	id,
	value,
	devices,
	copy = STEP_COPY,
	onChange,
}: {
	id: string;
	value: DeviceRef | undefined;
	/** The devices this node may name (`runs.devices` with `forNode`); undefined while they load. */
	devices: readonly DeviceChoice[] | undefined;
	copy?: DeviceFieldCopy;
	onChange: (device: string | undefined) => void;
}) {
	const chosen = deviceIdOf(value);
	const listed = [
		...new Map((devices ?? []).map((d) => [d.deviceId, d])).values(),
	];
	const shown = listed.filter(
		(d) => !d.dev || d.thisDevice || d.deviceId === chosen,
	);
	const oldName = legacyDeviceName(value);
	const unknown =
		chosen !== undefined && !listed.some((d) => d.deviceId === chosen);
	const label = (device: DeviceChoice) => {
		if (device.offers !== undefined && !device.thisDevice) {
			return `${device.name} (offers ${device.offers.join(", ")})`;
		}
		return device.thisDevice ? `${device.name} (this computer)` : device.name;
	};
	const items = [
		{ value: RUN_DEVICE, label: copy.run },
		...(oldName !== null
			? [{ value: OLD_NAME, label: `${oldName} (choose again)` }]
			: []),
		...(unknown && chosen !== undefined
			? [{ value: chosen, label: "A device that is not in this Space" }]
			: []),
		...shown.map((device) => ({
			value: device.deviceId,
			label: label(device),
		})),
	];
	const error =
		oldName !== null
			? oldDeviceMessage(oldName)
			: unknown && devices !== undefined
				? copy.unknown()
				: null;
	return (
		<Field
			id={id}
			label={copy.label}
			optional
			hint={copy.hint}
			// Only once the list is in: a device it lacks does not run.
			error={error}
		>
			<Select
				items={items}
				value={oldName !== null ? OLD_NAME : (chosen ?? RUN_DEVICE)}
				onValueChange={(next) => {
					if (next === null || next === OLD_NAME) return;
					onChange(next === RUN_DEVICE ? undefined : next);
				}}
			>
				<SelectTrigger
					id={id}
					className="w-full"
					aria-describedby={`${id}-hint`}
					aria-invalid={error !== null || undefined}
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
