import { describe, expect, test } from "bun:test";
import type { Flow } from "@nightshift/flows";

import { type FlowReader, flowUse, profileUseKey } from "./flow-use";

const project = (id: string, name: string) => ({ id, name });

/** A flow with these nodes. The rest of the flow does not matter here. */
const flowOf = (nodes: unknown[], inputs: unknown[] = []) =>
	({ nodes, inputs, edges: [] }) as never as Flow;

describe("flowUse", () => {
	test("finds the flows that name each connection, CLI tool, secret, and each Device's profile", async () => {
		const flows: Record<string, Flow> = {
			night: flowOf([
				{
					id: "plan",
					type: "agent",
					connections: ["gh"],
					clis: ["jq"],
					profile: { device: "mac", profile: "fast" },
				},
				{
					id: "fix",
					type: "agent",
					connections: ["gh"],
					profile: { device: "mac", profile: "fast" },
				},
				// The same profile id on another Device is another profile.
				{
					id: "far",
					type: "agent",
					profile: { device: "le2316", profile: "fast" },
				},
				// A name left from format 6 names no profile yet.
				{ id: "old", type: "agent", profile: "fast" },
				{ id: "file", type: "tool", connection: "linear" },
				{ id: "login", type: "command", secrets: ["API_USER", "API_PW"] },
				{ id: "again", type: "command", secrets: ["API_USER"] },
			]),
			day: flowOf([
				{ id: "a", type: "agent", profile: { device: "mac", profile: "slow" } },
				{ id: "check", type: "command" },
			]),
		};
		const reader: FlowReader = {
			listProjects: async () => [project("p1", "App"), project("p2", "Site")],
			listSchedules: async (projectId) => {
				if (projectId === "p2") throw new Error("not on this computer");
				return {
					schedules: [
						// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
						{ flow: "night", webhook: { secret: "${HOOK}" } },
						{ flow: "cron" },
					],
				};
			},
			flows: {
				map: async (projectId) => {
					if (projectId === "p2") throw new Error("not on this computer");
					// A flow that does not load uses nothing.
					return { ...flows, broken: null };
				},
			},
		};
		const use = await flowUse(reader);
		expect([...use.webhooks]).toEqual([
			["HOOK", [{ projectId: "p1", projectName: "App", flowName: "night" }]],
		]);
		const night = { projectId: "p1", projectName: "App", flowName: "night" };
		expect(use.connections.get("gh")).toEqual([night]);
		expect(use.connections.get("linear")).toEqual([night]);
		expect(use.clis.get("jq")).toEqual([night]);
		expect(use.secrets.get("API_USER")).toEqual([night]);
		expect(use.secrets.get("API_PW")).toEqual([night]);
		expect(use.secrets.size).toBe(2);
		expect(use.profiles.get(profileUseKey("mac", "fast"))).toEqual([
			{ ...night, nodeIds: ["plan", "fix"] },
		]);
		expect(use.profiles.get(profileUseKey("le2316", "fast"))).toEqual([
			{ ...night, nodeIds: ["far"] },
		]);
		expect(use.profiles.size).toBe(3);
		expect(use.profiles.get(profileUseKey("mac", "slow"))).toEqual([
			{ projectId: "p1", projectName: "App", flowName: "day", nodeIds: ["a"] },
		]);
		expect([...use.connections.keys()].sort()).toEqual(["gh", "linear"]);
	});
	test("a secret only a Web request, a Wait, a Service, a kit or a called flow uses is used too", async () => {
		const ref = (name: string) => `\${${name}}`;
		const flows: Record<string, Flow> = {
			watch: flowOf([
				{
					id: "fetch",
					type: "web-request",
					url: "https://api.example.com/items",
					headers: { Authorization: `Bearer ${ref("API_TOKEN")}` },
				},
				{
					id: "ready",
					type: "wait",
					until: {
						kind: "url",
						url: `https://status.example.com/${ref("JOB_KEY")}`,
						everyMinutes: 5,
					},
				},
				{ id: "stack", type: "service", secrets: ["DB_PASSWORD"] },
				{ id: "tell", type: "call", flow: "kit:message/send", inputs: {} },
				{
					id: "ping",
					type: "call",
					flow: "ping",
					inputs: { hook: "TEAM_CHAT_URL" },
				},
			]),
			ping: flowOf(
				[{ id: "send", type: "web-request", urlSecret: "{{hook}}" }],
				[{ name: "hook", type: "text" }],
			),
		};
		const reader: FlowReader = {
			listProjects: async () => [project("p1", "App")],
			listSchedules: async () => ({ schedules: [] }),
			flows: { map: async () => flows },
		};
		const use = await flowUse(reader);
		const watch = { projectId: "p1", projectName: "App", flowName: "watch" };
		expect(Object.fromEntries(use.secrets)).toEqual({
			API_TOKEN: [watch],
			JOB_KEY: [watch],
			DB_PASSWORD: [watch],
			MESSAGE_WEBHOOK_URL: [watch],
			TEAM_CHAT_URL: [watch],
		});
	});
});
