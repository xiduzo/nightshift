/**
 * PROTOTYPE, throw away. `?state=` on `/devices` swaps the real data for a
 * made-up Space, to see the hub in every state without setting one up.
 */
import type { RunSummary, ThisComputer } from "@/shared/api";
import type { SpaceComputer, SpaceHost } from "../space-view";
import type { Props } from "./parts";

export const DEVICE_STATES = [
	{ key: "live", name: "Live" },
	{ key: "loading", name: "Loading" },
	{ key: "error", name: "Error" },
	{ key: "fresh", name: "Fresh install" },
	{ key: "ready", name: "Host, no others" },
	{ key: "shared", name: "Shared, no members" },
	{ key: "offline", name: "Host offline" },
	{ key: "busy", name: "Busy" },
] as const;

const HOUR = 3_600_000;

function computer(
	o: Partial<SpaceComputer> & { id: string; name: string },
): SpaceComputer {
	return {
		platform: "darwin",
		online: true,
		lastSeenAt: null,
		thisDevice: false,
		mine: true,
		owner: null,
		clones: [],
		offers: [],
		paired: null,
		...o,
	};
}

function thisComputer(enabled: boolean): ThisComputer {
	return {
		id: "this",
		name: "studio-mac",
		platform: "darwin",
		keyStore: "keychain",
		host: {
			enabled,
			addresses: enabled ? ["https://studio-mac.tail1234.ts.net"] : [],
			reachable: "network",
			restartNeeded: false,
			fingerprint: null,
		},
		hosts: [],
	} as ThisComputer;
}

function linked(status: "online" | "offline", since: number): SpaceHost {
	return {
		kind: "linked",
		host: {
			hostId: "h",
			name: "nightshift-host",
			role: status === "online" ? "guest" : "home",
			homeHost: status !== "online",
			addresses: ["https://host.example.com"],
			address: status === "online" ? "https://host.example.com" : null,
			status,
			since,
			fingerprint: null,
			spaces: [],
		},
	};
}

function runs(...titles: string[]): RunSummary[] {
	return titles.map(
		(title, i) =>
			({
				id: `${title}-${i}`,
				title,
				status: "running",
				projectId: "p",
			}) as unknown as RunSummary,
	);
}

const self = computer({ id: "this", name: "studio-mac", thisDevice: true });
const projects = (n: number) =>
	Array.from({ length: n }, (_, i) => ({
		projectId: `p${i}`,
		projectName: `project-${i}`,
	})) as unknown as SpaceComputer["clones"];

export function applyState(props: Props, state: string | undefined): Props {
	const now = props.now;
	const base = {
		...props,
		loading: false,
		error: null,
		detail: null,
		elsewhere: null,
		runsOn: new Map<string, RunSummary[]>(),
	};
	const personal = { id: "s", name: "Personal", personal: true };
	switch (state) {
		case "loading":
			return { ...base, loading: true, view: null };
		case "error":
			return {
				...base,
				view: null,
				error: new Error("This computer does not answer."),
			};
		case "fresh":
			return {
				...base,
				space: personal,
				view: {
					host: { kind: "this-computer", computer: thisComputer(false) },
					yours: [self],
					members: [],
				},
				phones: [],
				phonesPending: false,
				phonesHere: false,
				hostName: "studio-mac",
				canPair: false,
				beAHost: false,
			};
		case "ready":
			return {
				...base,
				space: personal,
				view: {
					host: { kind: "this-computer", computer: thisComputer(true) },
					yours: [{ ...self, clones: projects(2) }],
					members: [],
				},
				phones: [],
				phonesPending: false,
				phonesHere: true,
				hostName: "studio-mac",
				canPair: true,
				beAHost: true,
			};
		case "shared":
			return {
				...base,
				space: { id: "s2", name: "Studio", personal: false },
				view: {
					host: linked("online", now - HOUR),
					yours: [{ ...self, clones: projects(1) }],
					members: [],
				},
				phones: [],
				phonesPending: false,
				phonesHere: true,
				hostName: "nightshift-host",
				canPair: false,
				beAHost: false,
			};
		case "offline":
			return {
				...base,
				space: personal,
				view: {
					host: linked("offline", now - 3 * HOUR),
					yours: [
						self,
						computer({
							id: "laptop",
							name: "travel-laptop",
							online: null,
						}),
					],
					members: [],
				},
				phones: [
					{
						id: "ph",
						name: "iPhone",
						platform: "ios",
						lastSeenAt: now - 5 * HOUR,
					} as Props["phones"][number],
				],
				phonesPending: false,
				phonesHere: true,
				hostName: "nightshift-host",
				canPair: false,
				beAHost: false,
			};
		case "busy": {
			const runsOn = new Map<string, RunSummary[]>([
				["this", runs("Nightly triage", "Fix flaky login test")],
				[
					"mini",
					runs("Write release notes", "Dependency bumps", "Docs review"),
				],
			]);
			return {
				...base,
				space: personal,
				runsOn,
				view: {
					host: { kind: "this-computer", computer: thisComputer(true) },
					yours: [
						{ ...self, clones: projects(4) },
						computer({
							id: "mini",
							name: "mac-mini",
							clones: projects(3),
							lastSeenAt: now,
						}),
						computer({
							id: "box",
							name: "linux-box",
							platform: "linux",
							online: false,
							lastSeenAt: now - 96 * HOUR,
							clones: projects(1),
						}),
						computer({
							id: "old",
							name: "old-laptop",
							online: false,
							paired: {
								revokedAt: now - 400 * HOUR,
							} as SpaceComputer["paired"],
						}),
					],
					members: [],
				},
				phones: [
					{
						id: "ph",
						name: "iPhone",
						platform: "ios",
						lastSeenAt: now - 0.2 * HOUR,
					} as Props["phones"][number],
					{
						id: "pad",
						name: "iPad",
						platform: "ios",
						lastSeenAt: now - 50 * HOUR,
					} as Props["phones"][number],
				],
				phonesPending: false,
				phonesHere: true,
				hostName: "studio-mac",
				canPair: true,
				beAHost: true,
			};
		}
		default:
			return props;
	}
}
