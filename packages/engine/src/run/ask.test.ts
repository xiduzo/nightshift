import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fakeHarness } from "@nightshift/agents/testing";
import type { CommandNode, Flow, FlowEdge, ValueNode } from "@nightshift/flows";
import { createRunLog, type RunLog } from "../log/run-log";
import {
	createSandbox,
	expectRunLogsInSync,
	mustGit,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createEngine } from "./engine";
import type { SpaceEngine } from "./space-engine";

/**
 * An Ask (a Value made by a person, ADR 10) through the whole engine: the
 * form in the Needs-you inbox, its choices from the run, its attachments
 * kept with the run, and an answer the engine holds to the form.
 */

let sandbox: Sandbox;
let runLogs: RunLog[];
beforeEach(async () => {
	sandbox = await createSandbox();
	runLogs = [];
});
afterEach(async () => {
	try {
		await expectRunLogsInSync(sandbox.db, runLogs);
	} finally {
		await sandbox.cleanup();
	}
});

function makeEngine(): SpaceEngine {
	const runLog = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
	runLogs.push(runLog);
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
		}),
		{ runLog },
	).space(sandbox.spaceId);
}

const at = { x: 0, y: 0 };

const VARIANTS = [
	{
		name: "calm",
		label: "Calm",
		description: "Soft colours",
		attachments: [{ path: "shots/calm.png", label: "Calm screen" }],
	},
	{ name: "bold", label: "Bold" },
];

const designer: CommandNode = {
	id: "designer",
	type: "command",
	position: at,
	command: `echo '${JSON.stringify({ variants: VARIANTS })}'`,
	output: "json",
};

const output = {
	type: "object",
	required: ["variant"],
	properties: {
		variant: { type: "string", description: "The variant to build" },
		comment: { type: "string" },
	},
};

function ask(extra: Partial<ValueNode> = {}): ValueNode {
	return {
		id: "pick",
		type: "value",
		position: at,
		by: "person",
		prompt: "Which variant?",
		output,
		choices: { from: "{{designer.data.variants}}", field: "variant" },
		attachments: [
			{ path: "shots/today.png" },
			{ url: "https://example.com/preview", label: "Preview" },
		],
		...extra,
	};
}

const builder: CommandNode = {
	id: "build",
	type: "command",
	position: at,
	command: 'echo "build {{pick.data.variant}}: {{pick.data.comment}}"',
	output: "text",
};

function flowOf(nodes: Flow["nodes"]): Flow {
	const edges: FlowEdge[] = nodes.slice(1).map((node, index) => ({
		id: `e${index}`,
		from: nodes[index]?.id ?? "",
		outcome: "pass",
		to: node.id,
	}));
	return {
		version: 7,
		inputs: [],
		outputs: [],
		start: "designer",
		nodes,
		edges,
	};
}

/** Two screenshots in the project, so the run's copy has them. */
async function withScreens(): Promise<void> {
	await mkdir(join(sandbox.repoPath, "shots"), { recursive: true });
	await Bun.write(join(sandbox.repoPath, "shots/today.png"), "png-today");
	await Bun.write(join(sandbox.repoPath, "shots/calm.png"), "png-calm");
	await mustGit(sandbox.repoPath, ["add", "shots"]);
	await mustGit(sandbox.repoPath, [
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.com",
		"commit",
		"-q",
		"-m",
		"screens",
	]);
}

async function start(engine: SpaceEngine, flow: Flow) {
	const projectId = (await engine.addProject({ repoPath: sandbox.repoPath }))
		.id;
	const run = await engine.startRun({ projectId, flow });
	const gate = await waitFor(
		async () => (await engine.listGates()).find((g) => g.runId === run.id),
		{ label: "an open Ask" },
	);
	return { run, gate };
}

async function waitForEnd(engine: SpaceEngine, runId: string) {
	return waitFor(
		async () => {
			const { status } = await engine.getRun(runId);
			return status === "running" || status === "waiting" ? null : status;
		},
		{ label: "the run's end" },
	);
}

describe("an Ask", () => {
	test("waits in the inbox with a form of the run's choices, and the answer becomes the data", async () => {
		await withScreens();
		const engine = makeEngine();
		const { run, gate } = await start(
			engine,
			flowOf([designer, ask(), builder]),
		);
		expect(gate).toMatchObject({
			nodeId: "pick",
			question: "Which variant?",
			choices: [{ name: "answer" }],
			lockScreen: false,
		});
		const form = gate.form;
		expect(form?.schema).toEqual({
			...output,
			properties: {
				...output.properties,
				variant: {
					type: "string",
					description: "The variant to build",
					enum: ["calm", "bold"],
				},
			},
		});
		expect(form?.choices?.field).toBe("variant");
		expect(form?.choices?.items.map((item) => item.label)).toEqual([
			"Calm",
			"Bold",
		]);
		expect(form?.choices?.items[0]?.description).toBe("Soft colours");

		// The files are kept with the run: the web and the phone show them.
		const kept = await engine.listArtifacts(run.id);
		expect(kept.map((file) => [file.name, file.title]).sort()).toEqual([
			["calm.png", "Calm screen"],
			["today.png", "today.png"],
		]);
		const today = kept.find((file) => file.name === "today.png");
		expect(form?.attachments).toEqual([
			{
				label: "today.png",
				artifactId: today?.id as string,
				mediaType: "image/png",
			},
			{ label: "Preview", url: "https://example.com/preview" },
		]);
		expect(form?.choices?.items[0]?.attachments?.[0]).toMatchObject({
			label: "Calm screen",
			mediaType: "image/png",
		});

		await engine.act(run.id, {
			kind: "answer",
			stepId: gate.stepId,
			choice: "answer",
			data: { variant: "bold", comment: "Bigger title" },
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		const detail = await engine.getRun(run.id);
		const pick = detail.steps.find((step) => step.nodeId === "pick");
		expect(pick?.outcome).toBe("pass");
		expect(pick?.outputs).toMatchObject({
			outcome: "pass",
			data: { variant: "bold", comment: "Bigger title" },
			note: "",
		});
		expect(
			detail.steps.find((step) => step.nodeId === "build")?.outputs.log_tail,
		).toBe("build bold: Bigger title");
	});

	test("refuses an answer that does not match the form, and still waits", async () => {
		await withScreens();
		const engine = makeEngine();
		const { run, gate } = await start(
			engine,
			flowOf([designer, ask({ attachments: undefined })]),
		);
		await expect(
			engine.act(run.id, {
				kind: "answer",
				stepId: gate.stepId,
				choice: "answer",
				data: { variant: "loud" },
			}),
		).rejects.toThrow("The answer does not match the form");
		await expect(
			engine.act(run.id, {
				kind: "answer",
				stepId: gate.stepId,
				choice: "answer",
			}),
		).rejects.toThrow("Fill in the form to answer.");
		expect(await engine.listGates()).toHaveLength(1);

		await engine.act(run.id, {
			kind: "answer",
			stepId: gate.stepId,
			choice: "answer",
			data: { variant: "calm" },
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
	});

	test("a choices list that is not valid ends the step before the Ask opens", async () => {
		const engine = makeEngine();
		const projectId = (await engine.addProject({ repoPath: sandbox.repoPath }))
			.id;
		const run = await engine.startRun({
			projectId,
			flow: flowOf([
				designer,
				ask({
					attachments: undefined,
					choices: { from: "{{designer.data}}", field: "variant" },
				}),
			]),
		});
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		const pick = (await engine.getRun(run.id)).steps.find(
			(step) => step.nodeId === "pick",
		);
		expect(pick?.outcome).toBe("error");
		expect(pick?.error).toBe(
			"The question could not open: The choices are not a list. Give a list of { name, label } from an earlier node.",
		);
	});

	test("a file outside the run's copy of the project is not kept", async () => {
		await withScreens();
		const engine = makeEngine();
		const projectId = (await engine.addProject({ repoPath: sandbox.repoPath }))
			.id;
		const run = await engine.startRun({
			projectId,
			flow: flowOf([
				designer,
				ask({ attachments: [{ path: "../../secrets.txt" }] }),
			]),
		});
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		const pick = (await engine.getRun(run.id)).steps.find(
			(step) => step.nodeId === "pick",
		);
		expect(pick?.error).toBe(
			'The question could not open: The file "../../secrets.txt" is not in the run\'s copy of the project. Give a path inside it.',
		);
		expect(await engine.listArtifacts(run.id)).toEqual([]);
	});
});
