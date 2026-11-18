import {
	type DeviceRef,
	deviceIdOf,
	legacyDeviceName,
} from "@nightshift/flows";
import { createContext, useContext } from "react";

/**
 * The names of the devices a node may name, by id: a node keeps the id,
 * and the canvas shows the name. Empty where a canvas does not know them.
 */
export const DeviceNamesContext = createContext<ReadonlyMap<string, string>>(
	new Map(),
);

/** What the canvas calls the device a node names: its name, a name from before ids, or "another computer". */
export function useDeviceLabel(device: DeviceRef): string {
	const names = useContext(DeviceNamesContext);
	const id = deviceIdOf(device);
	return (
		(id === undefined ? legacyDeviceName(device) : names.get(id)) ??
		"another computer"
	);
}
