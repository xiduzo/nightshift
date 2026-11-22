/**
 * The page readers of the knowledge (ADR 39): one port (`PageReader`) with
 * Night Shift's own reader, Jina Reader and Firecrawl, the step's reader on
 * a loopback listener, and the quick look at a link. `wireReaders` binds
 * the use cases to their ports.
 */

export type { LinkLook } from "./domain/link-look";
export type { ReaderSecret } from "./domain/reader-choice";
export { type PageReaders, wireReaders } from "./wire";
