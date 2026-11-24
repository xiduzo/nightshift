import type { Flow, Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { inMemoryAccess } from "../../../../access/adapters/out/in-memory-access";
import { inMemoryFiles } from "../../../files/adapters/out/in-memory-files";
import { checkReaderReady } from "../../../readers/application/check-reader-ready";
import { inMemorySync } from "../../../sync/adapters/out/in-memory-sync";
import type { SourcesSpace } from "../../application/ports";
import type { SourceRun } from "../../domain/syncs";
import { inMemoryWait } from "./in-memory-wait";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemorySourcesPorts`, which gives a use-case test every port of
 * the slice at once. Test code: production code never imports this file.
 */

/** One Space in memory, as one person sees it: its flows, schedules, runs and Devices. */
export type InMemorySourcesSpace = SourcesSpace & {
	/** The flows of each project, by name. Null: a flow that is not valid. */
	flows: SourcesSpace["flows"] & { saved: Map<string, Flow | null> };
	/** The schedules of the project, as its file holds them. */
	schedules: Schedule[];
	/** The latest runs of the project, newest first. */
	runs: SourceRun[];
	/** The Devices the Host knows. */
	devices: { deviceId: string; name: string }[];
	/** Each call, in order, by its name. */
	calls: string[];
	/** From now on `listSchedules` refuses: the project has no copy here. */
	noCopyHere(): void;
	/** From now on `listDevices` never answers. */
	devicesHang(): void;
};

export function inMemorySourcesSpace(): InMemorySourcesSpace {
	const saved = new Map<string, Flow | null>();
	let noCopy = false;
	let hangs = false;
	let started = 0;
	const twin: InMemorySourcesSpace = {
		schedules: [],
		runs: [],
		devices: [],
		calls: [],
		noCopyHere: () => {
			noCopy = true;
		},
		devicesHang: () => {
			hangs = true;
		},
		flows: {
			saved,
			async map() {
				twin.calls.push("flows.map");
				return Object.fromEntries(saved);
			},
			async save(_projectId, name, flow) {
				twin.calls.push(`flows.save ${name}`);
				saved.set(name, flow);
				return [];
			},
			async remove(_projectId, name) {
				twin.calls.push(`flows.remove ${name}`);
				saved.delete(name);
			},
		},
		async listSchedules() {
			twin.calls.push("listSchedules");
			if (noCopy) throw new Refusal("not-found", "No copy here.");
			return { schedules: [...twin.schedules] };
		},
		async saveSchedules(_projectId, schedules) {
			twin.calls.push("saveSchedules");
			twin.schedules = [...schedules];
			return undefined;
		},
		async listRuns({ limit }) {
			twin.calls.push(`listRuns ${limit}`);
			return twin.runs.slice(0, limit);
		},
		async startRun({ flowName }) {
			twin.calls.push(`startRun ${flowName}`);
			const run: SourceRun = {
				id: `run-${++started}`,
				status: "running",
				flowName,
				createdAt: 1,
				endedAt: null,
			};
			twin.runs.unshift(run);
			return run;
		},
		async listDevices() {
			twin.calls.push("listDevices");
			return hangs ? new Promise(() => {}) : [...twin.devices];
		},
	};
	return twin;
}

/**
 * Every port of knowledge/sources in memory at once, over the real sync,
 * files and page readers: where each use-case test starts. No secret of a
 * page reader is here.
 */
export function inMemorySourcesPorts(sync = inMemorySync()) {
	let clock = 1_000_000;
	const ready = checkReaderReady({ documents: sync.documents });
	return {
		access: inMemoryAccess(),
		space: inMemorySourcesSpace(),
		sync,
		files: inMemoryFiles(sync).reader,
		reconciler: sync.reconciler,
		readers: { ready: (projectId: string) => ready({ projectId }) },
		wait: inMemoryWait(),
		device: { id: "device-here", name: "This Mac" },
		now: () => clock,
		/** Sets the clock of `now`. */
		setNow(at: number) {
			clock = at;
		},
	};
}
