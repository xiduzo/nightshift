import { z } from "zod";
import { secretNameSchema } from "../../nodes";

/**
 * The page reader of a project's knowledge (ADR 39): what reads one web page
 * as Markdown for the Web pages source, and for the quick look at a link a
 * person tells. A per-project Knowledge setting, so every Device of the
 * Space reads the same way. The readers themselves are the engine's
 * (`knowledge/readers/`). This file holds what the kit, the engine and the
 * pages share: the setting, its defaults, and the names of the step's
 * variables.
 */

/** Every page reader, in the order a person meets them. */
export const PAGE_READER_KINDS = ["nightshift", "jina", "firecrawl"] as const;
export type PageReaderKind = (typeof PAGE_READER_KINDS)[number];

/**
 * What each reader needs that a person may change: the address of its
 * service and the secret that holds its key. Night Shift reads on this
 * computer, so it has neither.
 */
export const PAGE_READER_DEFAULTS = {
	nightshift: null,
	jina: { address: "https://r.jina.ai/", secret: "JINA_API_KEY" },
	firecrawl: {
		address: "https://api.firecrawl.dev",
		secret: "FIRECRAWL_API_KEY",
	},
} as const satisfies Record<
	PageReaderKind,
	{ address: string; secret: string } | null
>;

/** An address of a reader service: http or https, no credentials in it. */
const readerAddressSchema = z
	.string()
	.trim()
	.max(500)
	.refine(
		(value) => {
			try {
				const url = new URL(value);
				return (
					(url.protocol === "https:" || url.protocol === "http:") &&
					url.username === "" &&
					url.password === ""
				);
			} catch {
				return false;
			}
		},
		{ message: "Use an address such as https://reader.example.com/." },
	);

/**
 * The page reader setting. `address`: a self-hosted service instead of the
 * default. `secret`: the name of the secret with its key, instead of the
 * default name. A key is never in the setting itself.
 */
export const pageReaderSettingSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("nightshift") }),
	z.object({
		kind: z.literal("jina"),
		address: readerAddressSchema.optional(),
		secret: secretNameSchema.optional(),
	}),
	z.object({
		kind: z.literal("firecrawl"),
		address: readerAddressSchema.optional(),
		secret: secretNameSchema.optional(),
	}),
]);
export type PageReaderSetting = z.infer<typeof pageReaderSettingSchema>;

/** The reader of a project that no person chose: Night Shift's own. */
export const DEFAULT_PAGE_READER: PageReaderSetting = { kind: "nightshift" };

/**
 * The variables a Command step of a project with knowledge gets for its
 * page reader: the address of this computer's reader for the step, and the
 * step's own token for it. Without them (the reader did not open), the Web
 * pages source reads nothing and says so.
 */
export const PAGE_READER_ENV = {
	url: "NS_READER_URL",
	token: "NS_READER_TOKEN",
} as const;

/**
 * The header of each answer of the step's reader: how the read went. The
 * body is the page's file (`read`) or why it was not read (the others).
 */
export const PAGE_READ_HEADER = "x-nightshift-read";
