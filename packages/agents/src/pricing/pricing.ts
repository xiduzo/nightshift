/**
 * What a session or a model call cost, in US dollars at API prices: the
 * harness's own figure when it reports one, else its tokens times the price
 * of its model. A subscription does not change the figure: the person sees
 * what the work would cost on the API.
 *
 * The prices are `@pydantic/genai-prices`: its bundled list, replaced by a
 * newer one that `startPriceUpdates` fetches once a day and keeps in a file,
 * so a restart without a network still prices with the last list.
 */
import { readFile, rename, stat, utimes, writeFile } from "node:fs/promises";
import { asDate, now as timeNow } from "@nightshift/time";
import { calcPrice, updatePrices } from "@pydantic/genai-prices";
import type { AgentUsage, CostSource } from "../port";

export type { CostSource };

export type SettledCost =
	| { costUsd: number; costSource: CostSource }
	/** Neither: the harness reported no cost, and the model has no price or no tokens. */
	| { costUsd: null; costSource: null };

const UNKNOWN: SettledCost = { costUsd: null, costSource: null };

/** Tokens times the price of `model` on `at`; undefined when the list has no price for it. */
export function estimateCostUsd(
	usage: AgentUsage,
	model: string,
	options: { providerId?: string; at?: Date } = {},
): number | undefined {
	const result = calcPrice(
		{
			input_tokens: usage.inputTokens,
			output_tokens: usage.outputTokens,
			...(usage.cacheReadTokens !== undefined
				? { cache_read_tokens: usage.cacheReadTokens }
				: {}),
			...(usage.cacheWriteTokens !== undefined
				? { cache_write_tokens: usage.cacheWriteTokens }
				: {}),
			...(usage.cacheWrite1hTokens !== undefined
				? { cache_write_1h_tokens: usage.cacheWrite1hTokens }
				: {}),
		},
		model,
		{
			...(options.providerId ? { providerId: options.providerId } : {}),
			...(options.at ? { timestamp: options.at } : {}),
		},
	);
	return result ? result.total_price : undefined;
}

/** The harness's cost, else the estimate from its tokens, else unknown. */
export function settleCost(
	usage: AgentUsage | null | undefined,
	model: string | null | undefined,
	options: { providerId?: string; at?: Date } = {},
): SettledCost {
	if (!usage) return UNKNOWN;
	if (usage.costUsd !== undefined) {
		return { costUsd: usage.costUsd, costSource: "reported" };
	}
	// No tokens is no evidence: the harness did not count them.
	if (!model || usage.inputTokens + usage.outputTokens === 0) return UNKNOWN;
	const estimate = estimateCostUsd(usage, model, options);
	return estimate === undefined
		? UNKNOWN
		: { costUsd: estimate, costSource: "estimated" };
}

const DAY_MS = 24 * 60 * 60 * 1000;

type ProviderData = Parameters<
	Parameters<typeof updatePrices>[0]
>[0]["setProviderData"];

/** Set once: `updatePrices` hands over its setter a single time per process. */
let hooks: { url: string; set: ProviderData } | undefined;

function priceHooks(): { url: string; set: ProviderData } {
	if (!hooks) {
		updatePrices(({ remoteDataUrl, setProviderData }) => {
			hooks = { url: remoteDataUrl, set: setProviderData };
		});
	}
	if (!hooks) throw new Error("genai-prices did not hand over its price data");
	return hooks;
}

/** A price list as genai-prices writes it: an array of providers, each with models. */
function isPriceList(value: unknown): value is Parameters<ProviderData>[0] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every(
			(provider) =>
				typeof provider === "object" &&
				provider !== null &&
				typeof provider.id === "string" &&
				Array.isArray(provider.models),
		)
	);
}

export type PriceUpdates = {
	/** Fetches the list now, unless it did not change. */
	refresh(): Promise<void>;
	stop(): void;
};

/**
 * Keeps the price list current: loads the one in `file`, fetches a newer one
 * when it is older than `intervalMs`, then once per `intervalMs`. The ETag
 * makes an unchanged list cost one small request. A failed fetch keeps the
 * list it has and tells `onError`.
 */
export async function startPriceUpdates(options: {
	file: string;
	intervalMs?: number;
	fetch?: (url: string, init?: RequestInit) => Promise<Response>;
	onError?: (error: unknown) => void;
}): Promise<PriceUpdates> {
	const intervalMs = options.intervalMs ?? DAY_MS;
	const fetchList = options.fetch ?? fetch;
	const etagFile = `${options.file}.etag`;
	const { url, set } = priceHooks();

	const cached = await readFile(options.file, "utf8").catch(() => null);
	if (cached !== null) {
		try {
			const list: unknown = JSON.parse(cached);
			if (isPriceList(list)) set(list);
		} catch (error) {
			options.onError?.(error);
		}
	}

	const refresh = async () => {
		try {
			const etag = await readFile(etagFile, "utf8").catch(() => null);
			const response = await fetchList(url, {
				headers: etag ? { "if-none-match": etag } : {},
			});
			if (response.status === 304) {
				// Unchanged: the file counts as fresh, so a restart does not ask again.
				const now = asDate();
				await utimes(options.file, now, now).catch(() => undefined);
				return;
			}
			if (!response.ok) {
				throw new Error(`The price list answered ${response.status}.`);
			}
			const text = await response.text();
			const list: unknown = JSON.parse(text);
			if (!isPriceList(list)) throw new Error("The price list is not valid.");
			// Write, then rename: a crash never leaves half a list behind.
			await writeFile(`${options.file}.tmp`, text);
			await rename(`${options.file}.tmp`, options.file);
			const nextEtag = response.headers.get("etag");
			if (nextEtag) await writeFile(etagFile, nextEtag);
			set(list);
		} catch (error) {
			options.onError?.(error);
		}
	};

	const age = await stat(options.file)
		.then((file) => timeNow() - file.mtimeMs)
		.catch(() => Number.POSITIVE_INFINITY);
	if (age >= intervalMs) await refresh();
	const timer = setInterval(() => void refresh(), intervalMs);
	timer.unref?.();
	return { refresh, stop: () => clearInterval(timer) };
}
