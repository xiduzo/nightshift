import { describe, expect, test } from "bun:test";
import { deciderNameSchema } from "@nightshift/flows";

import { DECIDER_ADAPTERS } from "../decider-providers/registry";
import {
	cannotMakeValueMessage,
	DECIDER_LABELS,
	DECIDER_SETUP,
	defaultDeciderModel,
} from "./domain/catalogue";

/** The catalogue matches the adapters in `decider-providers` (same seam). */
describe("the catalogue matches decider-providers", () => {
	test("DECIDER_SETUP matches the registry", () => {
		expect(DECIDER_SETUP.typesafeKey).toBe("TYPESAFE_API_KEY");
		const ollama: string = DECIDER_ADAPTERS.ollama.defaultModel;
		expect<string>(DECIDER_SETUP.localModel.name).toBe(ollama);
	});

	test("defaultDeciderModel matches each adapter decision default", () => {
		for (const name of deciderNameSchema.options) {
			expect(defaultDeciderModel(name, "decision")).toBe(
				DECIDER_ADAPTERS[name].defaultModel,
			);
		}
	});

	test("labels match each adapter", () => {
		for (const name of deciderNameSchema.options) {
			expect(DECIDER_LABELS[name]).toBe(DECIDER_ADAPTERS[name].label);
		}
	});

	test("cannotMakeValueMessage names the decider", () => {
		expect(cannotMakeValueMessage("typesafe")).toContain(
			DECIDER_LABELS.typesafe,
		);
	});
});
