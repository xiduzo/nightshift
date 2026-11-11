import type { JsonValue } from "@nightshift/flows";
import { messageOf } from "../../context";
import { ConvertProblem } from "./problem";

/**
 * YAML with Bun's own reader and writer (`Bun.YAML`). A file of several
 * documents (`---` between them) reads as a list of them. What YAML holds
 * beyond JSON (a date, infinity) comes out as JSON would write it.
 */

export function readYaml(text: string): JsonValue {
	let parsed: unknown;
	try {
		parsed = Bun.YAML.parse(text);
	} catch (error) {
		throw new ConvertProblem(`The YAML is not valid: ${messageOf(error)}`);
	}
	return parsed === undefined
		? null
		: (JSON.parse(JSON.stringify(parsed)) as JsonValue);
}

export function writeYaml(value: JsonValue): string {
	return Bun.YAML.stringify(value, null, 2);
}
