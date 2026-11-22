import { PAGE_READ_HEADER } from "@nightshift/flows";
import type { ReaderRoute } from "./reader-endpoint";

/**
 * The step's reader as a route of the listener (`reader-endpoint.ts`): each
 * request of the step under its path (`read`, `links`, `map`) becomes one
 * call of the step's reader, and its answer becomes the response the Web
 * pages kit reads. The wire hands it the reader that `openStepReader` gave.
 */

/** The step's reader, as `openStepReader` gives it. */
type StepReader = {
	read(
		url: string,
		options: { fresh: boolean; signal: AbortSignal },
	): Promise<
		| { kind: "refused"; reason: string }
		| { kind: "answer"; status: string; body: string }
	>;
	links(url: string): Promise<string[]>;
	map(
		start: string,
		options: { limit: string | null; signal: AbortSignal },
	): Promise<string[] | null>;
};

const lines = (urls: readonly string[]) =>
	new Response(urls.length > 0 ? `${urls.join("\n")}\n` : "", {
		headers: { "content-type": "text/plain; charset=utf-8" },
	});

export function stepRoute(reader: StepReader): ReaderRoute {
	return {
		async handle(action, params, signal) {
			switch (action) {
				case "read": {
					const read = await reader.read(params.get("url") ?? "", {
						fresh: params.get("fresh") === "1",
						signal,
					});
					if (read.kind === "refused") {
						return new Response(read.reason, { status: 400 });
					}
					return new Response(read.body, {
						headers: {
							"content-type": "text/plain; charset=utf-8",
							[PAGE_READ_HEADER]: read.status,
						},
					});
				}
				case "links":
					return lines(await reader.links(params.get("url") ?? ""));
				case "map": {
					const urls = await reader.map(params.get("url") ?? "", {
						limit: params.get("limit"),
						signal,
					});
					return urls === null
						? new Response(null, { status: 204 })
						: lines(urls);
				}
				default:
					return new Response("Not found.", { status: 404 });
			}
		},
	};
}
