import { describe, expect, test } from "bun:test";
import type { Flow } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { inMemoryConfigUsePorts } from "../adapters/out/in-memory-neighbours";
import { listSharedSecretUse } from "./list-shared-secret-use";

const at = { spaceId: "s1", personId: "ada" };
const flowOf = (...nodes: unknown[]) =>
	({ nodes, inputs: [], edges: [] }) as never as Flow;
const uses = (secret: string) =>
	flowOf({ id: "call", type: "command", secrets: [secret] });

describe("listSharedSecretUse", () => {
	test("lists the flows of the project that use each of its secrets", async () => {
		const ports = inMemoryConfigUsePorts();
		ports.connections.shared = { p1: ["API_KEY"] };
		ports.spaces.projects = [
			{ id: "p1", name: "App", flows: { night: uses("API_KEY") } },
			{ id: "p2", name: "Site", flows: { day: uses("API_KEY") } },
		];
		const listed = await listSharedSecretUse(ports)({
			at,
			owner: { projectId: "p1" },
		});
		expect(listed?.map((s) => [s.name, s.flows, s.tools])).toEqual([
			["API_KEY", ["night"], []],
		]);
	});

	test("the Space's secrets name the flows of every project", async () => {
		const ports = inMemoryConfigUsePorts();
		ports.connections.shared = { space: ["API_KEY"] };
		ports.spaces.projects = [
			{ id: "p1", name: "App", flows: { night: uses("API_KEY") } },
			{ id: "p2", name: "Site", flows: { day: uses("API_KEY") } },
		];
		const listed = await listSharedSecretUse(ports)({ at, owner: "space" });
		expect(listed?.[0]?.flows).toEqual(["day", "night"]);
	});

	test("null when the Host that keeps them cannot be reached", async () => {
		const ports = inMemoryConfigUsePorts();
		ports.connections.shared = {
			space: new Refusal("unavailable", "The Host cannot be reached."),
		};
		expect(await listSharedSecretUse(ports)({ at, owner: "space" })).toBeNull();
		expect(ports.spaces.asked).toEqual([]);
	});
});
