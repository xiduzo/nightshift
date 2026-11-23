import type { HistoryPort } from "./tanstack-history-tools";

export function inMemoryHistoryPort(): HistoryPort {
	throw new Error("Tests build their own HistoryPort.");
}