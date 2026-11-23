import { expect } from "bun:test";

import type { Programs } from "../../application/ports";

/** The contract of Programs: a name on PATH, a missing name, a PATH fix. */
export function programsContract(
	name: string,
	make: () => {
		programs: Programs;
		present: string;
		presentPath: string;
		missing: string;
	},
) {
	return {
		name,
		cases: [
			{
				name: "finds a program that is here",
				run: () => {
					const { programs, present, presentPath } = make();
					expect(programs.where(present)).toBe(presentPath);
				},
			},
			{
				name: "a missing program is null",
				run: () => {
					const { programs, missing } = make();
					expect(programs.where(missing)).toBeNull();
				},
			},
			{
				name: "putBinsOnPath returns whether PATH changed",
				run: () => {
					const { programs } = make();
					expect(typeof programs.putBinsOnPath()).toBe("boolean");
				},
			},
		],
	};
}
