import { describe, expect, test } from "bun:test";
import type { LinkedHost, SpaceDevice, ThisComputer } from "@/shared/api";
import { neededMachines, spaceMachines } from "./machines";
import { spaceView } from "./space-view";

const thisComputer = (
	hosts: LinkedHost[] = [],
	hostEnabled = false,
): ThisComputer => ({
	id: "self",
	name: "LE2316",
	platform: "darwin",
	keyStore: "keychain",
	host: {
		enabled: hostEnabled,
		addresses: [],
		reachable: "network",
		restartNeeded: false,
		fingerprint: null,
	},
	hosts,
});

const host = (status: LinkedHost["status"] = "online"): LinkedHost => ({
	hostId: "host-1",
	name: "hetzner-1",
	role: "home",
	addresses: ["https://host.example.com"],
	address: null,
	status,
	since: 7,
	fingerprint: null,
	spaces: [{ id: "personal", name: "Personal", personal: true }],
});

const device = (id: string, extra: Partial<SpaceDevice> = {}): SpaceDevice => ({
	id,
	name: id,
	online: null,
	thisDevice: false,
	mine: true,
	owner: null,
	platform: null,
	lastSeenAt: null,
	clones: [],
	offers: [],
	...extra,
});

const keez = { projectId: "keez", projectName: "KEEZ" };

const machinesOf = (
	linked: LinkedHost[],
	devices: SpaceDevice[],
	hostEnabled = false,
) =>
	spaceMachines(
		spaceView({
			spaceId: "personal",
			personal: true,
			thisComputer: thisComputer(linked, hostEnabled),
			paired: [],
			devices,
		}),
	);

describe("spaceMachines", () => {
	test("in a Space a Host keeps, the Host starts the schedules, with its link's status", () => {
		const machines = machinesOf(
			[host("offline")],
			[device("self", { name: "LE2316", thisDevice: true, clones: [keez] })],
		);
		expect(machines.starterIsHost).toBe(true);
		expect(machines.starter).toMatchObject({
			name: "hetzner-1",
			online: false,
			lastSeenAt: 7,
			projectIds: [],
		});
		expect(machines.byName("hetzner-1")?.name).toBe("hetzner-1");
		expect(machines.byName("LE2316")?.projectIds).toEqual(["keez"]);
	});

	test("a Host with a copy of a project is a computer of the Space too", () => {
		const machines = machinesOf(
			[host()],
			[
				device("self", { name: "LE2316", thisDevice: true }),
				device("host-1", { name: "hetzner-1", clones: [keez] }),
			],
		);
		expect(machines.starter).toMatchObject({
			id: "host-1",
			online: true,
			projectIds: ["keez"],
		});
	});

	test("alone in its Space, this computer starts the schedules", () => {
		const machines = machinesOf(
			[],
			[device("self", { name: "LE2316", thisDevice: true })],
		);
		expect(machines.starterIsHost).toBe(false);
		expect(machines.starter).toMatchObject({ name: "LE2316", online: true });
	});
});

describe("neededMachines", () => {
	const machines = machinesOf(
		[host()],
		[
			device("self", { name: "LE2316", thisDevice: true }),
			device("studio", { online: false, lastSeenAt: 3 }),
		],
	);

	test("the run's computer first, then each one the flow names, once", () => {
		expect(
			neededMachines(machines, "LE2316", {
				names: ["studio", "LE2316"],
				ids: ["studio"],
			}).map((m) => [m.name, m.online]),
		).toEqual([
			["LE2316", true],
			["studio", false],
		]);
	});

	test("no device: the run runs on the Host; a name the Space does not know has no status", () => {
		expect(
			neededMachines(machines, undefined, {
				names: ["gone"],
				ids: ["nobody"],
			}).map((m) => [m.name, m.online]),
		).toEqual([
			["hetzner-1", true],
			["gone", null],
			["A device", null],
		]);
	});

	test("null leaves the run's computer out: only what the flow names", () => {
		expect(
			neededMachines(machines, null, { names: ["hetzner-1"], ids: [] }).map(
				(m) => m.name,
			),
		).toEqual(["hetzner-1"]);
	});
});
