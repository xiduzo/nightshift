import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { Scope } from "../../log";

/** The scope of the flow this graph runs in: null at the top level. */
export function scopeOf(config: LangGraphRunnableConfig): Scope | null {
	return (config.configurable?.scope as Scope | null | undefined) ?? null;
}
