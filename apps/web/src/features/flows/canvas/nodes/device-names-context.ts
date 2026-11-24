import { createContext, useContext } from "react";

/**
 * The names of the devices a node may name, by id: a node keeps the id,
 * and the canvas shows the name. Empty where a canvas does not know them.
 */
export const DeviceNamesContext = createContext<ReadonlyMap<string, string>>(
	new Map(),
);

/** What the canvas calls the device a node names: its name, or "another computer". */
export function useDeviceLabel(device: string): string {
	const names = useContext(DeviceNamesContext);
	return names.get(device) ?? "another computer";
}
