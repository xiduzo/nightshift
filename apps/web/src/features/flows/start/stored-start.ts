import type { InputTexts } from "@nightshift/client";
import type { FlowInputDef } from "@nightshift/flows";

const STORAGE_KEY = "nightshift:stop-time";
const DEFAULT_TIME = "07:00";

type StoredStop = { on: boolean; time: string };

/** The stop time of the last start. Storage can be missing or blocked. */
export function readStoredStop(): StoredStop {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<StoredStop>;
			if (typeof parsed.time === "string" && typeof parsed.on === "boolean") {
				return { on: parsed.on, time: parsed.time };
			}
		}
	} catch {
		// Fall through to the default.
	}
	return { on: false, time: DEFAULT_TIME };
}

export function writeStoredStop(stop: StoredStop) {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stop));
	} catch {
		// Not remembered; the dialog still works.
	}
}

export type InputValues = InputTexts;

function inputsKey(projectId: string, flowName: string) {
	return `nightshift:inputs:${projectId}:${flowName}`;
}

/** The values of the last start of this flow, for the names it still declares. */
export function readStoredInputs(
	projectId: string,
	flowName: string,
	inputs: FlowInputDef[],
): InputValues {
	const values: InputValues = {};
	try {
		const raw = window.localStorage.getItem(inputsKey(projectId, flowName));
		const parsed: unknown = raw ? JSON.parse(raw) : null;
		if (parsed && typeof parsed === "object") {
			for (const { name } of inputs) {
				const value = (parsed as Record<string, unknown>)[name];
				if (typeof value === "string") values[name] = value;
			}
		}
	} catch {
		// Start with empty fields.
	}
	return values;
}

export function writeStoredInputs(
	projectId: string,
	flowName: string,
	values: InputValues,
) {
	try {
		window.localStorage.setItem(
			inputsKey(projectId, flowName),
			JSON.stringify(values),
		);
	} catch {
		// Not remembered; the dialog still works.
	}
}
