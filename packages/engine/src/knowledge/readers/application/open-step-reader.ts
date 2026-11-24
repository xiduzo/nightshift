import type { KnowledgeDocuments } from "../../sync";
import { type ReaderSecret, readerOf } from "../domain/reader-choice";
import {
	isPageAddress,
	mapLimit,
	NOT_A_PAGE,
	pageFile,
	type StepRead,
} from "../domain/step-reads";
import type { ReaderServices, ReadMarks } from "./ports";

export type OpenStepReaderPorts = {
	documents: Pick<KnowledgeDocuments, "open">;
	services: Pick<ReaderServices, "local" | "service">;
	marks: ReadMarks;
};

/** The project of the Command step, and the secrets of the step's scopes: a key the reader needs comes from them. */
export type OpenStepReader = { projectId: string; secret: ReaderSecret };

/** The project's reader for one Command step: what the step asks of it, until `close`. */
export type StepReader = {
	/** One page: its file, or why it was not read. `fresh`: read it whole, as if no read came before. */
	read(
		url: string,
		options: { fresh: boolean; signal: AbortSignal },
	): Promise<StepRead>;
	/** The links of a page the step read, else the ones its last read kept. */
	links(url: string): Promise<string[]>;
	/** The addresses of a site, from a reader that finds them itself. Null: this reader does not, or `start` is no web address. */
	map(
		start: string,
		options: { limit: string | null; signal: AbortSignal },
	): Promise<string[] | null>;
	/** Writes the marks that wait. */
	close(): Promise<void>;
};

/**
 * Opens the project's page reader for one Command step (ADR 39). A read
 * asks with the mark of the last read, so a page that did not change
 * answers `unchanged`. The marks outlive the step.
 */
export const openStepReader =
	(ports: OpenStepReaderPorts) =>
	async ({ projectId, secret }: OpenStepReader): Promise<StepReader> => {
		const { marks } = ports;
		const reader = await readerOf(
			(await ports.documents.open(projectId)).reader(),
			secret,
			ports.services,
		);
		/** The links of each page this step read, for `links`. */
		const links = new Map<string, string[]>();
		return {
			async read(url, { fresh, signal }) {
				if (!isPageAddress(url)) return { kind: "refused", reason: NOT_A_PAGE };
				const before = fresh
					? undefined
					: (await marks.get(projectId, reader.kind, url))?.mark;
				const read = await reader.read(url, {
					...(before ? { before } : {}),
					signal,
				});
				switch (read.status) {
					case "read":
						links.set(url, read.links);
						await marks.set(projectId, reader.kind, url, read);
						return {
							kind: "answer",
							status: "read",
							body: pageFile(url, read),
						};
					case "unchanged": {
						const kept = await marks.get(projectId, reader.kind, url);
						await marks.set(projectId, reader.kind, url, {
							mark: read.mark,
							links: kept?.links ?? [],
						});
						return { kind: "answer", status: "unchanged", body: "" };
					}
					default:
						return { kind: "answer", status: read.status, body: read.reason };
				}
			},
			async links(url) {
				return (
					links.get(url) ??
					(await marks.get(projectId, reader.kind, url))?.links ??
					[]
				);
			},
			async map(start, { limit, signal }) {
				if (!reader.map || !isPageAddress(start)) return null;
				return reader.map(start, { limit: mapLimit(limit), signal });
			},
			close: () => marks.flush(),
		};
	};
