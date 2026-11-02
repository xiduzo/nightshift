import { createHmac } from "node:crypto";

const MINUTE_MS = 60_000;

/** HMAC-SHA256 of `id`, hex, cut to 16 characters. The key stays on this computer. */
export function hashId(key: string, id: string): string {
	return createHmac("sha256", key).update(id).digest("hex").slice(0, 16);
}

/** Epoch ms, rounded down to the minute. */
export function minuteOf(at: number): number {
	return Math.floor(at / MINUTE_MS) * MINUTE_MS;
}

/** A duration in whole seconds. Negative becomes zero. */
export function secondsOf(ms: number): number {
	if (!Number.isFinite(ms)) return 0;
	return Math.max(0, Math.round(ms / 1000));
}

/** US dollars rounded to whole cents. */
export function centsOf(usd: number): number {
	if (!Number.isFinite(usd)) return 0;
	return Math.round(usd * 100) / 100;
}

/**
 * Hours from a duration. The seconds are whole first, then the hours may
 * be a fraction.
 */
export function hoursOf(ms: number): number {
	return secondsOf(ms) / 3600;
}

/**
 * A model name as a known family. A local or private model, and any name
 * that matches none, is `_OTHER`.
 */
export function modelFamily(model: string): string {
	const name = model.toLowerCase();
	if (
		name.includes("ollama") ||
		name.includes("local") ||
		name.includes("private") ||
		name.startsWith("http:") ||
		name.startsWith("https:")
	) {
		return "_OTHER";
	}
	if (name.includes("claude")) {
		if (name.includes("opus")) return "claude-opus";
		if (name.includes("haiku")) return "claude-haiku";
		if (name.includes("sonnet")) return "claude-sonnet";
		return "_OTHER";
	}
	if (name.includes("gpt-5") || name.includes("gpt5")) return "gpt-5";
	if (name.includes("gemini")) return "gemini";
	if (name.includes("grok")) return "grok";
	return "_OTHER";
}

/** The provider a harness proves. Anything else is omitted, not guessed. */
export function providerOf(harness: string): string | undefined {
	switch (harness) {
		case "claude-code":
			return "anthropic";
		case "codex":
			return "openai";
		case "grok-build":
			return "x_ai";
		case "gemini":
			return "gcp.gemini";
		default:
			return undefined;
	}
}
