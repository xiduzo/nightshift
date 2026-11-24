import { describe, expect, test } from "bun:test";
import { inMemorySyncPorts } from "../adapters/out/in-memory-neighbours";
import type { KnowledgeEntry } from "../domain/entry";
import { reconcileFolder } from "./reconcile-folder";

/** The use case reconcileFolder, on in-memory adapters. */

const bytes = (text: string) => new TextEncoder().encode(text);

/** Ports whose calls go into one log, in order. */
function loggedPorts() {
	const ports = inMemorySyncPorts();
	const log: string[] = [];
	const { copy, archive, documents, hosts, listener } = ports;
	const scan = copy.scan.bind(copy);
	const remove = copy.remove.bind(copy);
	const write = copy.write.bind(copy);
	const writeState = copy.writeState.bind(copy);
	const put = archive.put.bind(archive);
	const read = archive.read.bind(archive);
	const open = documents.open.bind(documents);
	const heard = listener.reconciled.bind(listener);
	copy.scan = (projectId) => {
		log.push("scan");
		return scan(projectId);
	};
	copy.remove = (projectId, path) => {
		log.push(`remove ${path}`);
		return remove(projectId, path);
	};
	copy.write = (projectId, path, content) => {
		log.push(`write ${path}`);
		return write(projectId, path, content);
	};
	copy.writeState = (projectId, text) => {
		log.push("state");
		return writeState(projectId, text);
	};
	archive.put = (file) => {
		log.push(`put ${file.ref.sha256.slice(0, 4)}`);
		return put(file);
	};
	archive.read = (ref) => {
		log.push(`get ${ref.sha256.slice(0, 4)}`);
		return read(ref);
	};
	documents.open = async (projectId) => {
		const document = await open(projectId);
		return {
			...document,
			apply: (change) => {
				log.push("document");
				return document.apply(change);
			},
		};
	};
	hosts.inStep = async (_spaceId, _names, { timeoutMs }) => {
		log.push(`wait ${timeoutMs}`);
	};
	listener.reconciled = (change) => {
		log.push("hook");
		return heard(change);
	};
	return { ports, log };
}

/** An entry of another Device, whose content its Host keeps. */
function fromHost(
	ports: ReturnType<typeof inMemorySyncPorts>,
	text: string,
	changedAt: number,
): KnowledgeEntry {
	const sha256 = ports.copy.hash(text);
	ports.archive.host.set(`s1/${sha256}`, bytes(text));
	return { sha256, size: bytes(text).length, changedAt, deviceId: "desktop" };
}

describe("reconcileFolder", () => {
	test("the first reconcile publishes the folder's files and keeps their state", async () => {
		const ports = inMemorySyncPorts();
		ports.copy.put("p1", "a.md", "# A\n", 5);
		await reconcileFolder(ports)({ projectId: "p1" });
		const sha256 = ports.copy.hash("# A\n");
		const entries = (await ports.documents.open("p1")).entries();
		expect(entries.get("a.md")).toEqual({
			sha256,
			size: 4,
			changedAt: 5,
			deviceId: "laptop",
		});
		expect(ports.archive.host.has(`s1/${sha256}`)).toBe(true);
		const state = JSON.parse(ports.copy.state("p1") ?? "{}");
		expect(state.files["a.md"].mtimeMs).toBe(5);
		expect(state.unpushed).toEqual([]);
		expect(ports.pending.has("p1")).toBe(false);
	});

	test("keeps the order of a pass", async () => {
		const { ports, log } = loggedPorts();
		const document = await ports.documents.open("p1");
		await document.apply({ set: [["b.md", fromHost(ports, "# B\n", 7)]] });
		ports.copy.put("p1", "a.md", "# A\n", 5);
		ports.copy.put("p1", "gone.md", "g", 6);
		const waiting = ports.copy.hash("u");
		ports.archive.keepHere(
			{ kind: "content", spaceId: "s1", sha256: waiting },
			bytes("u"),
		);
		await ports.copy.writeState(
			"p1",
			JSON.stringify({
				files: {
					"gone.md": {
						sha256: ports.copy.hash("g"),
						size: 1,
						changedAt: 6,
						deviceId: "laptop",
						mtimeMs: 6,
					},
				},
				unpushed: [waiting],
			}),
		);
		log.length = 0;

		await reconcileFolder(ports)({ projectId: "p1" });

		const short = (text: string) => ports.copy.hash(text).slice(0, 4);
		expect(log).toEqual([
			"wait 3000",
			`put ${short("u")}`,
			"scan",
			`put ${short("# A\n")}`,
			"remove gone.md",
			`get ${short("# B\n")}`,
			"write b.md",
			"document",
			"state",
			"hook",
			"wait 10000",
		]);
		expect(ports.copy.text("p1", "b.md")).toBe("# B\n");
		expect(ports.copy.text("p1", "gone.md")).toBeUndefined();
	});

	test("a Host that is down: the content waits, and the next reconcile copies it", async () => {
		const ports = inMemorySyncPorts();
		ports.archive.down = true;
		ports.copy.put("p1", "a.md", "# A\n", 5);
		await reconcileFolder(ports)({ projectId: "p1" });
		expect(ports.pending.has("p1")).toBe(true);
		const state = JSON.parse(ports.copy.state("p1") ?? "{}");
		expect(state.unpushed).toEqual([ports.copy.hash("# A\n")]);
		ports.archive.down = false;
		await reconcileFolder(ports)({ projectId: "p1" });
		expect(ports.pending.has("p1")).toBe(false);
		expect(ports.archive.host.has(`s1/${ports.copy.hash("# A\n")}`)).toBe(true);
	});

	test("a project this Replica does not have: nothing happens", async () => {
		const ports = inMemorySyncPorts();
		ports.copy.put("gone", "a.md", "# A\n", 5);
		await reconcileFolder(ports)({ projectId: "gone" });
		expect(ports.copy.calls).toEqual([]);
		expect(ports.documents.changes).toEqual([]);
	});

	test("two reconciles of one folder take turns", async () => {
		const ports = inMemorySyncPorts();
		const order: string[] = [];
		let release = () => {};
		ports.hosts.inStep = async (_spaceId, _names, { timeoutMs }) => {
			order.push(`wait ${timeoutMs}`);
			if (order.length === 1) await new Promise<void>((r) => (release = r));
		};
		ports.copy.put("p1", "a.md", "# A\n", 5);
		const first = reconcileFolder(ports)({ projectId: "p1" });
		const second = reconcileFolder(ports)({ projectId: "p1" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(order).toEqual(["wait 3000"]);
		release();
		await Promise.all([first, second]);
		// The second starts after the first ended: its own wait comes last.
		expect(order).toEqual(["wait 3000", "wait 10000", "wait 3000"]);
	});
});
