import { describe, expect, test } from "bun:test";
import {
	inMemoryCopiesPorts,
	inMemoryCopySpace,
} from "../adapters/out/in-memory-neighbours";
import { failCopy } from "../domain/copies";
import { listProjectCopies } from "./list-project-copies";

describe("listProjectCopies", () => {
	test("the copies that run, then the ones that failed", () => {
		const ports = inMemoryCopiesPorts();
		void inMemoryCopySpace;
		ports.state.copying.set("app", Promise.resolve(null));
		failCopy(ports.state, "lab", "No.", 0);
		failCopy(ports.state, "app", "Old.", 0);
		expect(listProjectCopies(ports)()).toEqual([
			{ projectId: "app", state: "copying", problem: null },
			{ projectId: "lab", state: "failed", problem: "No." },
		]);
	});
});
