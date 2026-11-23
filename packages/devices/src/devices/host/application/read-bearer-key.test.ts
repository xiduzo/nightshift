import { describe, expect, test } from "bun:test";
import { inMemoryHostPorts } from "../adapters/out/in-memory-neighbours";
import { readBearerKey } from "./read-bearer-key";

describe("readBearerKey", () => {
	test("resolves a Bearer key, and returns null without one", async () => {
		const p = inMemoryHostPorts();
		const access = {
			keyId: "k",
			deviceId: "laptop",
			personId: "ada",
			permissions: { sync: ["pull"] },
		};
		p.keys.access.set("secret", access);
		p.bearerOf = (headers) => headers.get("authorization")?.slice(7) ?? null;
		expect(await readBearerKey(p)(new Headers())).toBeNull();
		expect(
			await readBearerKey(p)(new Headers({ authorization: "Bearer secret" })),
		).toEqual(access);
	});
});
