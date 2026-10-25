import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/client";

import { createApiClient, createQueryUtils } from "./client";
import { createQueryClient } from "./query-client";

/** A Host that answers each call the same: a reply of `status` with `body`, or no reply at all. */
function hostThat(answer: { status: number; body: unknown } | "is-down") {
	let calls = 0;
	const fetch = async () => {
		calls += 1;
		if (answer === "is-down") throw new TypeError("Network request failed");
		return new Response(JSON.stringify(answer.body), {
			status: answer.status,
			headers: { "content-type": "application/json" },
		});
	};
	const orpc = createQueryUtils(
		createApiClient({ baseUrl: "http://localhost:3000", fetch }),
	);
	return { orpc, calls: () => calls };
}

/** How the Host refuses a call, the oRPC way. */
function refusal(code: string, status: number) {
	return {
		status,
		body: { json: { defined: false, code, status, message: code } },
	};
}

/** Reads `queryFn` once through the client, without the waits between tries. */
async function tries(queryFn: () => Promise<unknown>): Promise<number> {
	let count = 0;
	const client = createQueryClient();
	await client
		.fetchQuery({
			queryKey: ["tries"],
			queryFn: () => {
				count += 1;
				return queryFn();
			},
			retryDelay: 0,
		})
		.catch(() => undefined);
	return count;
}

describe("the query client of an app", () => {
	test("tries again three times while the Host does not answer", async () => {
		const host = hostThat("is-down");
		const client = createQueryClient();
		const options = host.orpc.projects.list.queryOptions();
		await expect(
			client.fetchQuery({ ...options, retryDelay: 0 }),
		).rejects.toThrow();
		expect(host.calls()).toBe(4);
	});

	test("does not try again when the Host refuses the call", async () => {
		for (const [code, status] of [
			["UNAUTHORIZED", 401],
			["FORBIDDEN", 403],
			["NOT_FOUND", 404],
			["INTERNAL_SERVER_ERROR", 500],
		] as const) {
			const host = hostThat(refusal(code, status));
			const client = createQueryClient();
			const options = host.orpc.projects.list.queryOptions();
			const error = await client
				.fetchQuery({ ...options, retryDelay: 0 })
				.catch((caught: unknown) => caught);
			expect((error as { code?: string }).code).toBe(code);
			expect(host.calls()).toBe(1);
		}
	});

	test("tries again when a proxy says the Host did not answer", async () => {
		expect(
			await tries(() =>
				Promise.reject(new ORPCError("BAD_GATEWAY", { status: 502 })),
			),
		).toBe(4);
		expect(
			await tries(() =>
				Promise.reject(new ORPCError("GATEWAY_TIMEOUT", { status: 504 })),
			),
		).toBe(4);
	});

	test("does not try again on an error the procedure defines", async () => {
		const defined = new ORPCError("HOST_UNREACHABLE", {
			status: 503,
			defined: true,
		});
		expect(await tries(() => Promise.reject(defined))).toBe(1);
	});

	test("keeps data fresh for a minute", () => {
		const client = createQueryClient();
		expect(client.getDefaultOptions().queries?.staleTime).toBe(60 * 1000);
	});
});

describe("the errors of the query client", () => {
	const failing = (meta?: Record<string, unknown>) => ({
		queryKey: ["failing", meta],
		queryFn: () =>
			Promise.reject(
				new ORPCError("NOT_FOUND", { status: 404, message: "The run is gone" }),
			),
		meta,
	});

	test("go to the app's handler first, and a handled one shows nowhere else", async () => {
		const handled: unknown[] = [];
		const shown: unknown[] = [];
		const client = createQueryClient({
			handle: (_client, error) => {
				handled.push(error);
				return true;
			},
			show: (error) => shown.push(error),
		});
		await client.fetchQuery(failing()).catch(() => undefined);
		await client
			.getMutationCache()
			.build(client, {
				mutationFn: () => Promise.reject(new Error("not sent")),
			})
			.execute(undefined)
			.catch(() => undefined);
		expect(handled).toHaveLength(2);
		expect(shown).toHaveLength(0);
	});

	test("show when nothing handles them and the query is not quiet", async () => {
		const shown: string[] = [];
		const client = createQueryClient({
			handle: () => false,
			show: (error) => shown.push(error.message),
		});
		await client.fetchQuery(failing()).catch(() => undefined);
		await client
			.fetchQuery(failing({ quietErrors: true }))
			.catch(() => undefined);
		expect(shown).toEqual(["The run is gone"]);
	});

	test("of a background read stay quiet while the query keeps its data", async () => {
		const shown: string[] = [];
		const client = createQueryClient({
			show: (error) => shown.push(error.message),
		});
		const query = failing({ quietRefetchErrors: true });
		await client.fetchQuery(query).catch(() => undefined);
		client.setQueryData(query.queryKey, ["kept"]);
		await client.refetchQueries({ queryKey: query.queryKey });
		expect(shown).toEqual(["The run is gone"]);
	});
});
