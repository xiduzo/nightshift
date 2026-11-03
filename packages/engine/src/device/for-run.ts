import type { StepRun } from "../device-config";
import type { Device } from "./types";

/**
 * A step's Device, working for one run: each session, command and tool
 * call names the run, so the Device reads that run's Project secrets for
 * it (ADR 13). Everything else is the Device as is.
 */
export function forRun(device: Device, run: StepRun): Device {
	return {
		...device,
		session: (input) => device.session({ ...input, run }),
		exec: (input) => device.exec({ ...input, run }),
		callTool: (input) => device.callTool({ ...input, run }),
	};
}
