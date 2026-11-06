import { describe, expect, test } from "bun:test";
import { HostUnreachableError, OlderHostError } from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import { ORPCError } from "@orpc/client";
import type { HostClient } from "../contract";
import { partialHostClient } from "../testing";
import {
	fromHost,
	HOST_TOO_SLOW,
	hostCall,
	NOT_PAIRED,
	NotPairedError,
	translated,
} from "./from-host";

/**
 * A Host answers a call of this computer about its Device key, not about
 * the person's session here. So its errors reach the person in this
 * computer's words: never a 401 that sends them to sign in, the kind of a
 * refusal as the Host meant it, and a Host that does not know the
 * procedure says it runs an older version. The Link does this once, for
 * every procedure it hands out.
 */

describe("the error a person gets for a Host's error", () => {
	test("a key the Host no longer knows asks to pair this computer again", () => {
		for (const error of [
			new ORPCError("UNAUTHORIZED", {
				message: "This device has no access here. Pair it again.",
			}),
			new ORPCError("BAD_REQUEST", {
				message: "Sign in.",
				data: { kind: "signed-out" },
			}),
		]) {
			const refusal = fromHost(error);
			expect(refusal).toBeInstanceOf(NotPairedError);
			expect(refusal).toMatchObject({ kind: "conflict", message: NOT_PAIRED });
		}
	});

	test("a refusal keeps the Host's words and the kind it sends", () => {
		const refusal = fromHost(
			new ORPCError("BAD_REQUEST", {
				message: "This run does not exist.",
				data: { kind: "not-found" },
			}),
		);
		expect(refusal).toBeInstanceOf(Refusal);
		expect(refusal).toMatchObject({
			kind: "not-found",
			message: "This run does not exist.",
		});
	});

	test("a refusal of an older Host has no kind: it is not valid", () => {
		expect(
			fromHost(new ORPCError("BAD_REQUEST", { message: "Not like this." })),
		).toMatchObject({ kind: "invalid", message: "Not like this." });
		expect(
			fromHost(
				new ORPCError("BAD_REQUEST", {
					message: "Not like this.",
					data: { kind: "a kind from later" },
				}),
			),
		).toMatchObject({ kind: "invalid" });
	});

	test("a procedure the Host does not know is a Host of an older version: the caller's words, or the one sentence", () => {
		for (const error of [
			new ORPCError("NOT_FOUND", { message: "Not found" }),
			// A route the Host does not serve: its server's own 404, no code.
			new ORPCError("INTERNAL_SERVER_ERROR", { status: 404 }),
		]) {
			const older = fromHost(error);
			expect(older).toBeInstanceOf(OlderHostError);
			expect(older).toMatchObject({
				kind: "unavailable",
				message: new OlderHostError().message,
			});
			expect(fromHost(error, "Update it to use leases.")).toMatchObject({
				message: "Update it to use leases.",
			});
		}
	});

	test("the Host's other codes are refusals of their kind", () => {
		expect(
			fromHost(new ORPCError("FORBIDDEN", { message: "Your role…" })),
		).toMatchObject({ kind: "forbidden", message: "Your role…" });
		expect(
			fromHost(new ORPCError("CONFLICT", { message: "Not yet." })),
		).toMatchObject({ kind: "conflict", message: "Not yet." });
		expect(
			fromHost(new ORPCError("HOST_UNREACHABLE", { status: 503 })),
		).toBeInstanceOf(HostUnreachableError);
	});

	test("a failure of the Host is a failure here: plain words, the details in the log", () => {
		const failure = new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Something went wrong.",
		});
		const error = fromHost(failure);
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(Refusal);
		expect((error as Error).cause).toBe(failure);
	});

	test("an error that is not the Host's passes on as it is", () => {
		const lost = new TypeError("The network connection was lost.");
		expect(fromHost(lost)).toBe(lost);
	});
});

describe("the Host's procedures in this computer's words", () => {
	/** A Host whose `sync.addProject` and `archive.follow` answer as given. */
	function host(answers: {
		addProject?: () => Promise<{ projectId: string }>;
		follow?: () => Promise<AsyncIterable<unknown>>;
	}) {
		return translated(
			partialHostClient({
				sync: answers.addProject ? { addProject: answers.addProject } : {},
				archive: answers.follow
					? { follow: answers.follow as HostClient["archive"]["follow"] }
					: {},
			}),
		);
	}
	const add = (client: HostClient) =>
		client.sync.addProject({ spaceId: "s", name: "app", remote: "r" });

	test("a procedure answers as the Host does, and its error comes translated", async () => {
		expect(
			await add(host({ addProject: async () => ({ projectId: "p" }) })),
		).toEqual({ projectId: "p" });
		await expect(
			add(
				host({
					addProject: () =>
						Promise.reject(new ORPCError("UNAUTHORIZED", { message: "No." })),
				}),
			),
		).rejects.toBeInstanceOf(NotPairedError);
		// The procedure is read at the call: a Host that changes it later is called as it is then.
		const raw = {
			sync: {
				addProject: (): Promise<{ projectId: string }> =>
					Promise.reject(new ORPCError("NOT_FOUND")),
			},
		};
		const client = translated(raw as unknown as HostClient);
		await expect(add(client)).rejects.toBeInstanceOf(OlderHostError);
		raw.sync.addProject = async () => ({ projectId: "p" });
		expect(await add(client)).toEqual({ projectId: "p" });
	});

	test("a stream's errors come translated too, and closing it closes the Host's", async () => {
		let closed = false;
		const client = host({
			follow: async () =>
				(async function* () {
					try {
						yield { seq: 1 };
						throw new ORPCError("FORBIDDEN", { message: "Not yours." });
					} finally {
						closed = true;
					}
				})(),
		});
		const entries = await client.archive.follow({
			step: { spaceId: "s", runId: "r", stepId: "st" },
			afterSeq: 0,
		});
		const seen: unknown[] = [];
		const failed = await (async () => {
			for await (const entry of entries) seen.push(entry);
		})().catch((error: unknown) => error);
		expect(seen).toEqual([{ seq: 1 }]);
		expect(failed).toBeInstanceOf(Refusal);
		expect(failed).toMatchObject({ kind: "forbidden", message: "Not yours." });

		closed = false;
		const again = await client.archive.follow({
			step: { spaceId: "s", runId: "r", stepId: "st" },
			afterSeq: 0,
		});
		for await (const _entry of again) break;
		expect(closed).toBe(true);
	});

	test("a procedure a fake Host does not serve rejects, as the fake does", async () => {
		await expect(
			translated(partialHostClient({})).sync.devices({
				spaceId: "s",
				projectId: "p",
			}),
		).rejects.toThrow("does not serve sync.devices");
	});
});

describe("one call on the Host, within its deadline", () => {
	const client = partialHostClient({});

	test("answers, or gives up after its deadline with the deadline's error, and then its signal aborts", async () => {
		expect(await hostCall(client, async () => "answered")).toBe("answered");
		let aborted = false;
		const never = (_client: HostClient, signal: AbortSignal) =>
			new Promise<never>((_, reject) => {
				signal.addEventListener("abort", () => {
					aborted = true;
					reject(new Error("aborted"));
				});
			});
		await expect(
			hostCall(client, never, { deadlineMs: 20 }),
		).rejects.toMatchObject({ kind: "unavailable", message: HOST_TOO_SLOW });
		expect(aborted).toBe(true);
		await expect(
			hostCall(client, never, {
				deadlineMs: 20,
				late: () => new HostUnreachableError(),
			}),
		).rejects.toBeInstanceOf(HostUnreachableError);
	});

	test("a call that settles in time keeps its signal: a stream it opened runs on", async () => {
		let signal: AbortSignal | undefined;
		await hostCall(
			client,
			async (_client, given) => {
				signal = given;
			},
			{ deadlineMs: 20 },
		);
		await Bun.sleep(40);
		expect(signal?.aborted).toBe(false);
	});

	test("a Host of an older version says the caller's words for the procedure", async () => {
		const older = () => Promise.reject(new OlderHostError());
		const said = await hostCall(client, older, {
			olderHost: "Update it to use leases.",
		}).catch((error: unknown) => error);
		expect(said).toBeInstanceOf(OlderHostError);
		expect(said).toMatchObject({ message: "Update it to use leases." });
		// Without words of its own, the Link's: as they came.
		const thrown = new OlderHostError();
		await expect(hostCall(client, () => Promise.reject(thrown))).rejects.toBe(
			thrown,
		);
		// Any other error passes as it is.
		const refused = new Refusal("forbidden", "Your role…");
		await expect(
			hostCall(client, () => Promise.reject(refused), { olderHost: "Update." }),
		).rejects.toBe(refused);
	});
});
