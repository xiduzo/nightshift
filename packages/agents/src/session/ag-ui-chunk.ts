/**
 * The AG-UI chunks that `chat()` yields, and what the translator reads in
 * one: its usage, and the name, the input and the error state of a tool
 * call. The adapters put some of these on the chunk and some in its
 * `metadata.tanstack`, so each read checks both.
 */

import type { AgentUsage } from "../port";
import { asNumber, asString, isRecord } from "./raw-value";

/** The AG-UI chunk shape this module reads. Every field is checked at runtime. */
export type AgUiChunk = { type: string; [key: string]: unknown };

export function usageFromChunk(chunk: AgUiChunk): AgentUsage | undefined {
	const metadata = isRecord(chunk.metadata) ? chunk.metadata : undefined;
	const tanstack =
		metadata && isRecord(metadata.tanstack) ? metadata.tanstack : undefined;
	const usage = isRecord(chunk.usage)
		? chunk.usage
		: tanstack && isRecord(tanstack.usage)
			? tanstack.usage
			: undefined;
	if (!usage) return undefined;
	const details = isRecord(usage.providerUsageDetails)
		? usage.providerUsageDetails
		: undefined;
	const costUsd = details ? asNumber(details.totalCostUsd) : undefined;
	const prompt = isRecord(usage.promptTokensDetails)
		? usage.promptTokensDetails
		: undefined;
	const cacheReadTokens = prompt ? asNumber(prompt.cachedTokens) : undefined;
	const cacheWriteTokens = prompt
		? asNumber(prompt.cacheWriteTokens)
		: undefined;
	return {
		inputTokens: asNumber(usage.promptTokens) ?? 0,
		outputTokens: asNumber(usage.completionTokens) ?? 0,
		...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
		...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
		...(costUsd !== undefined ? { costUsd } : {}),
	};
}

export function toolInput(chunk: AgUiChunk): unknown {
	if ("input" in chunk && chunk.input !== undefined) return chunk.input;
	const metadata = isRecord(chunk.metadata) ? chunk.metadata : undefined;
	const tanstack =
		metadata && isRecord(metadata.tanstack) ? metadata.tanstack : undefined;
	return tanstack?.input ?? {};
}

export function toolName(chunk: AgUiChunk): string | undefined {
	const metadata = isRecord(chunk.metadata) ? chunk.metadata : undefined;
	const tanstack =
		metadata && isRecord(metadata.tanstack) ? metadata.tanstack : undefined;
	return (
		asString(chunk.toolCallName) ??
		asString(chunk.toolName) ??
		asString(tanstack?.toolCallName) ??
		asString(tanstack?.toolName)
	);
}

export function isErrorResult(chunk: AgUiChunk): boolean {
	if (chunk.state === "output-error") return true;
	const metadata = isRecord(chunk.metadata) ? chunk.metadata : undefined;
	const tanstack =
		metadata && isRecord(metadata.tanstack) ? metadata.tanstack : undefined;
	return tanstack?.state === "output-error";
}
