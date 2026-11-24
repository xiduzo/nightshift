import { describe, expect, test } from "bun:test";
import { personalPorts } from "../test-support";
import { splitPersonalSpace } from "./split-personal-space";

async function withHostSpace(slug: string) {
	const ports = await personalPorts();
	await ports.person({
		id: "ada",
		name: "Ada",
		email: "a@x.org",
		role: "user",
	});
	await ports.personalSpaceStore.create({
		id: "host",
		name: "Personal",
		slug,
		personId: "ada",
		membershipId: "m-host",
	});
	return ports;
}

const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: Error) => error.message,
	);

describe("splitPersonalSpace", () => {
	test("a new Space becomes the one personal Space, and the Host's is no longer hers here", async () => {
		const ports = await withHostSpace("host-host");
		const rows = await splitPersonalSpace(ports)({
			personId: "ada",
			from: "host",
			to: "new",
			hostName: "Studio",
		});
		await ports.run(rows);
		expect(await ports.spaces()).toEqual([
			{
				id: "host",
				name: "Personal on Studio",
				slug: "host-host",
				personal: false,
			},
			{ id: "new", name: "Personal", slug: "personal-ada", personal: true },
		]);
		expect(await ports.members()).toEqual([
			{ id: "id-1", spaceId: "new", personId: "ada", role: "owner" },
		]);
	});

	test("an older Space with the slug keeps it: the new one gets its own", async () => {
		const ports = await withHostSpace("personal-ada");
		const rows = await splitPersonalSpace(ports)({
			personId: "ada",
			from: "host",
			to: "new",
			hostName: "Studio",
		});
		await ports.run(rows);
		expect((await ports.spaces()).find((s) => s.id === "new")?.slug).toBe(
			"personal-ada-new",
		);
	});

	test("only the Person's personal Space splits, into a Space that is not here yet", async () => {
		const ports = await withHostSpace("host-host");
		const split = splitPersonalSpace(ports);
		const at = { personId: "ada", hostName: "Studio" };
		expect(await refusalOf(split({ ...at, from: "other", to: "new" }))).toBe(
			"The Space other is not the personal Space of ada.",
		);
		expect(await refusalOf(split({ ...at, from: "host", to: "host" }))).toBe(
			"The Space host is on this Replica already.",
		);
	});
});
