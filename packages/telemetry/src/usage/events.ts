import type { LandedFact, RunTrace, UsageMoment } from "@nightshift/engine";
import { USAGE_EVENT } from "@nightshift/semconv";

import {
	hashId,
	hoursOf,
	modelFamily,
	providerOf,
	secondsOf,
} from "./anonymize";
import { eventOf, known, listed, type UsageEventName } from "./fields";

const RUN = USAGE_EVENT.runEnded;
const STEP = USAGE_EVENT.stepEnded;

/** One anonymous event, or null when it does not parse. */
function draft(
	name: UsageEventName,
	fields: Record<string, unknown>,
): Record<string, unknown> | null {
	return eventOf(name, fields);
}

function whole(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.round(value));
}

function endReason(end: {
	status: string;
	reason: string | null;
	endReason?: string | null;
}): string {
	if (end.endReason) {
		const exact = known(RUN, "run.end_reason", end.endReason);
		if (exact) return exact;
	}
	if ((end.reason === null || end.reason === "") && end.status === "finished") {
		return known(RUN, "run.end_reason", "finished") ?? "_OTHER";
	}
	return "_OTHER";
}

function nodeKinds(trace: RunTrace): string[] {
	const kinds: string[] = [];
	for (const step of trace.steps) {
		const kind = listed(STEP, "node.kind", step.nodeType, "_OTHER");
		if (!kinds.includes(kind)) kinds.push(kind);
	}
	return kinds;
}

function runCost(trace: RunTrace): number {
	let usd = 0;
	for (const step of trace.steps) {
		for (const end of step.ends) {
			if (end.costUsd !== null) usd += end.costUsd;
			else {
				for (const session of end.sessions) {
					if (session.costUsd !== null) usd += session.costUsd;
				}
			}
		}
	}
	return Math.round(usd * 100) / 100;
}

/** A run that ended. The flow name and the run id are hashed, never stored. */
export function runEndedEvent(
	fact: Extract<LandedFact, { kind: "run-ended" }>,
	trace: RunTrace,
	key: string,
): Record<string, unknown> | null {
	const end =
		trace.ends.find((item) => item.seq === fact.seq) ?? trace.ends.at(-1);
	if (!end) return null;
	const status = listed(RUN, "run.status", end.status, "_OTHER");
	return draft(RUN, {
		"flow.id": hashId(key, `${trace.projectId ?? ""}\n${trace.flowName ?? ""}`),
		"run.cost_usd": runCost(trace),
		"run.duration": secondsOf(end.at - end.openedAt),
		"run.end_reason": endReason(end),
		"run.node_kinds": nodeKinds(trace),
		"run.status": status,
		"run.trigger": listed(RUN, "run.trigger", trace.trigger, "_OTHER"),
	});
}

function stepResult(outcome: string): string {
	const value = outcome === "fail" ? "error" : outcome;
	return listed(STEP, "step.result", value, "_OTHER");
}

/** A step that ended. Error text stays out. Only `_OTHER` may name the error. */
export function stepEndedEvent(
	fact: Extract<LandedFact, { kind: "step-ended" }>,
	trace: RunTrace,
	_key: string,
): Record<string, unknown> | null {
	const step = trace.steps.find((item) => item.id === fact.stepId);
	const end =
		step?.ends.find((item) => item.seq === fact.seq) ?? step?.ends.at(-1);
	if (!step || !end) return null;
	const session = end.sessions.find((item) => providerOf(item.harness));
	const model = end.sessions.find((item) => item.model)?.model ?? null;
	const tokens = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	};
	for (const item of end.sessions) {
		tokens.input += item.tokens.input;
		tokens.output += item.tokens.output;
		tokens.cacheRead += item.tokens.cacheRead;
		tokens.cacheWrite += item.tokens.cacheWrite;
	}
	const provider = session
		? known(STEP, "provider.name", providerOf(session.harness) ?? "")
		: undefined;
	const family = model
		? (known(STEP, "model.family", modelFamily(model)) ??
			known(STEP, "model.family", "_OTHER"))
		: undefined;
	const basis = known(STEP, "cost.basis", end.costBasis);
	const hasTokens = end.sessions.length > 0;
	return draft(STEP, {
		"error.type": end.error ? "_OTHER" : undefined,
		"provider.name": provider,
		"cache_read.input_tokens": hasTokens ? whole(tokens.cacheRead) : undefined,
		"cache_write.input_tokens": hasTokens
			? whole(tokens.cacheWrite)
			: undefined,
		"usage.input_tokens": hasTokens ? whole(tokens.input) : undefined,
		"usage.output_tokens": hasTokens ? whole(tokens.output) : undefined,
		"cost.basis": basis,
		"model.family": family,
		"node.kind": listed(STEP, "node.kind", step.nodeType, "_OTHER"),
		"step.result": stepResult(end.outcome),
		"step.visit": whole(step.visit),
		"step.guard": end.guard
			? listed(STEP, "step.guard", end.guard, "_OTHER")
			: undefined,
	});
}

function skipReason(reason: string): string {
	if (reason.startsWith("Missed by ")) return "missed";
	if (reason.startsWith("You paused this schedule")) return "paused";
	if (reason.startsWith("An earlier run of this schedule is still ")) {
		return "still_open";
	}
	return "_OTHER";
}

function checkStatus(
	id: string,
	steps: { id: string; status: string }[],
): string {
	const status = steps.find((step) => step.id === id)?.status ?? "skipped";
	return listed(USAGE_EVENT.projectChecked, `check.${id}`, status, "skipped");
}

function bucket(count: number): string {
	const value = count <= 0 ? "0" : count === 1 ? "1" : count < 5 ? "2-4" : "5+";
	return listed(USAGE_EVENT.installActive, "install.members", value, "0");
}

/**
 * A noted moment as an anonymous event. `key` hashes ids. A moment that
 * does not parse, or whose provider cannot be proved, is dropped.
 */
export function momentEvent(
	moment: UsageMoment,
	key: string,
	platform: { os: string; arch: string; version: string },
): Record<string, unknown> | null {
	switch (moment.kind) {
		case "flow-created": {
			const starter = moment.starter
				? listed(
						USAGE_EVENT.flowCreated,
						"flow.starter",
						moment.starter,
						"_OTHER",
					)
				: undefined;
			return draft(USAGE_EVENT.flowCreated, {
				"flow.from": listed(
					USAGE_EVENT.flowCreated,
					"flow.from",
					moment.from,
					"_OTHER",
				),
				"flow.starter": starter,
			});
		}
		case "schedule-changed":
			return draft(USAGE_EVENT.scheduleChanged, {
				"schedule.enabled": moment.enabled,
				"schedule.webhook": moment.webhook,
				"schedule.score_pull_requests": moment.scorePullRequests,
			});
		case "schedule-fired":
			return draft(USAGE_EVENT.scheduleFired, {});
		case "schedule-skipped":
			return draft(USAGE_EVENT.scheduleSkipped, {
				"schedule.skip_reason": listed(
					USAGE_EVENT.scheduleSkipped,
					"schedule.skip_reason",
					skipReason(moment.reason),
					"_OTHER",
				),
			});
		case "gate-answered":
			return draft(USAGE_EVENT.gateAnswered, {
				"gate.by": listed(
					USAGE_EVENT.gateAnswered,
					"gate.by",
					moment.by,
					"person",
				),
				"gate.has_deadline": moment.hasDeadline,
				"gate.is_form": moment.isForm,
				"gate.via": listed(
					USAGE_EVENT.gateAnswered,
					"gate.via",
					moment.via,
					"_OTHER",
				),
				"gate.wait": secondsOf(moment.waitMs),
			});
		case "run-scored":
			return draft(USAGE_EVENT.runScored, {
				"run.id": hashId(key, moment.runId),
				"score.name": listed(
					USAGE_EVENT.runScored,
					"score.name",
					scoreName(moment.score),
					"_OTHER",
				),
				"score.value": scoreValue(moment.value),
				"score.hours":
					moment.elapsedMs === undefined
						? undefined
						: hoursOf(moment.elapsedMs),
			});
		case "project-added":
			return draft(USAGE_EVENT.projectAdded, {
				"project.has_remote": moment.hasRemote,
				"project.source": listed(
					USAGE_EVENT.projectAdded,
					"project.source",
					moment.source,
					"_OTHER",
				),
				"project.starters": whole(moment.starters),
			});
		case "project-checked":
			return draft(USAGE_EVENT.projectChecked, {
				"check.git": checkStatus("git", moment.steps),
				"check.folder": checkStatus("folder", moment.steps),
				"check.commit": checkStatus("commit", moment.steps),
				"check.identity": checkStatus("identity", moment.steps),
				"check.tools": checkStatus("tools", moment.steps),
			});
		case "agent-checked": {
			const provider = providerOf(moment.harness);
			const proved = provider
				? known(USAGE_EVENT.agentChecked, "provider.name", provider)
				: undefined;
			if (!proved) return null;
			return draft(USAGE_EVENT.agentChecked, {
				"provider.name": proved,
				"agent.harness": listed(
					USAGE_EVENT.agentChecked,
					"agent.harness",
					moment.harness,
					"_OTHER",
				),
				"agent.installed": moment.installed,
				"agent.signed_in": known(
					USAGE_EVENT.agentChecked,
					"agent.signed_in",
					moment.signIn,
				),
			});
		}
		case "install-started":
			return draft(USAGE_EVENT.installStarted, {
				"install.entry": listed(
					USAGE_EVENT.installStarted,
					"install.entry",
					moment.entry,
					"_OTHER",
				),
				"install.host": moment.host,
			});
		case "install-active": {
			const os = known(USAGE_EVENT.installActive, "os.type", platform.os);
			const arch = known(USAGE_EVENT.installActive, "host.arch", platform.arch);
			if (!os || !arch) return null;
			return draft(USAGE_EVENT.installActive, {
				"host.arch": arch,
				"host.paired": moment.paired,
				"install.agents": whole(moment.agents),
				"install.members": bucket(moment.members),
				"install.spaces": listed(
					USAGE_EVENT.installActive,
					"install.spaces",
					bucket(moment.spaces),
					"0",
				),
				"phone.signed_in": moment.phone,
				"os.type": os,
				"service.version": platform.version,
			});
		}
		case "knowledge-document-measured":
			return draft(USAGE_EVENT.knowledgeDocumentMeasured, {
				"project.id": hashId(key, moment.projectId),
				"document.kilobytes": Math.ceil(whole(moment.bytes) / 1000),
			});
		case "process-crashed":
			return draft(USAGE_EVENT.processCrashed, { "error.type": "_OTHER" });
		default:
			return null;
	}
}

/** A score's value: 0 or more, rounded to two decimals. */
function scoreValue(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.round(Math.max(0, value) * 100) / 100;
}

/** An older log names the useful answer `pr_useful`. It is the same score. */
function scoreName(score: string): string {
	return score === "pr_useful" ? "useful" : score;
}
