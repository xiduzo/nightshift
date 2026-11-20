import { describe, expect, test } from "bun:test";
import { inMemoryMembersPorts } from "../adapters/out/in-memory-neighbours";
import { listPersonNames } from "./list-person-names";

describe("listPersonNames", () => {
	test("names the Persons this Replica knows", async () => {
		const ports = inMemoryMembersPorts();
		await ports.seed.person({ id: "ada", name: "Ada", email: "a@x.org" });
		expect(await listPersonNames(ports)({ ids: ["ada", "bo"] })).toEqual(
			new Map([["ada", "Ada"]]),
		);
	});

	test("no ids, no question to the store", async () => {
		const asked: unknown[] = [];
		const names = listPersonNames({
			personStore: {
				names: async (ids) => {
					asked.push(ids);
					return new Map();
				},
			},
		});
		expect(await names({ ids: [] })).toEqual(new Map());
		expect(asked).toEqual([]);
	});
});
