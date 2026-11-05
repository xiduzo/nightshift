import type { StepRun } from "../device-config";
import type { Device } from "./types";

/**
 * A Device on which a step runs with the values of its profile of the same
 * name there (ADR 17). The node's own values came from the Device it left.
 */
export function withProfileValues(device: Device, fields: object): Device {
	return {
		...device,
		session: (input) =>
			device.session("offered" in input ? input : { ...input, ...fields }),
		decide: ((input: Parameters<Device["decide"]>[0]) =>
			device.decide({ ...input, ...fields } as never)) as Device["decide"],
	};
}

/**
 * A step's Device, working for one run: each session, command, tool call
 * and decider call names the run, so the Device reads that run's Project
 * secrets for it (ADR 13). Everything else is the Device as is.
 */
export function forRun(device: Device, run: StepRun): Device {
	return {
		...device,
		session: (input) => device.session({ ...input, run }),
		exec: (input) => device.exec({ ...input, run }),
		callTool: (input) => device.callTool({ ...input, run }),
		// A decision or a value: the overloads take either input.
		decide: ((input: Parameters<Device["decide"]>[0]) =>
			device.decide({ ...input, run } as never)) as Device["decide"],
	};
}
