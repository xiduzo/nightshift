import { describe, expect, test } from "bun:test";

import { usefulOptions } from "./useful-mutation";

describe("runs.useful", () => {
	test("prefers useful on the runs query factory", () => {
		const used = { path: "" };
		const options = usefulOptions(
			{
				runs: {
					useful: {
						mutationOptions: () => {
							used.path = "procedure";
							return { mutationFn: async () => undefined };
						},
					},
				},
			},
			{
				useful: () => {
					used.path = "factory";
					return { mutationFn: async () => undefined };
				},
			},
		);
		expect(used.path).toBe("factory");
		expect(options.mutationFn).toBeDefined();
	});

	test("calls runs.useful.mutationOptions when the factory has no useful", () => {
		const used = { path: "", options: undefined as object | undefined };
		const passed = { onSuccess: () => undefined };
		usefulOptions(
			{
				runs: {
					useful: {
						mutationOptions: (input?: object) => {
							used.path = "procedure";
							used.options = input;
							return { mutationFn: async () => undefined };
						},
					},
				},
			},
			{},
			passed,
		);
		expect(used.path).toBe("procedure");
		expect(used.options).toBe(passed);
	});
});
