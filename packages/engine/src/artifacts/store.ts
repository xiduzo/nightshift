import { randomUUID } from "node:crypto";
import { appendFile, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { now } from "@nightshift/time";

/**
 * Artifacts: files a run keeps for the person, such as the screenshots of a
 * design step or the recording of a test. An agent keeps one with the
 * `save_artifact` tool; the Device that runs the session copies the file
 * here, so the agent may change or delete its own copy afterwards.
 *
 * Like transcripts, artifacts are files in the data directory, never in
 * the event log: `<dataDir>/artifacts/<runId>/<id><ext>`, with one NDJSON
 * line per artifact in `<dataDir>/artifacts/<runId>/index.ndjson`. They
 * stay on the Device that ran the step.
 */

/** One artifact of a run, as the index keeps it. */
export type Artifact = {
	id: string;
	/** The step that kept it. */
	stepId: string;
	/** The file name the agent gave, for a download. */
	name: string;
	/** The agent's title, else the file name. */
	title: string;
	/** From the file name: `image/png`, `video/mp4`, … */
	mediaType: string;
	/** Bytes. */
	size: number;
	/** Epoch ms. */
	savedAt: number;
};

/** The largest file an agent may keep. */
export const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

export type ArtifactStore = ReturnType<typeof createArtifactStore>;

export function createArtifactStore(dataDir: string) {
	const runDir = (runId: string) => join(dataDir, "artifacts", runId);
	const indexPath = (runId: string) => join(runDir(runId), "index.ndjson");
	const filePath = (runId: string, artifact: Pick<Artifact, "id" | "name">) =>
		join(runDir(runId), `${artifact.id}${extname(artifact.name)}`);

	/** The run's artifacts, oldest first. A missing index is none; a torn line is skipped. */
	async function list(runId: string): Promise<Artifact[]> {
		let text: string;
		try {
			text = await readFile(indexPath(runId), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
		const artifacts: Artifact[] = [];
		for (const line of text.split("\n")) {
			if (!line) continue;
			try {
				const artifact = JSON.parse(line) as Artifact;
				if (typeof artifact.id === "string") artifacts.push(artifact);
			} catch {
				// Skip a torn line.
			}
		}
		return artifacts;
	}

	return {
		list,

		/**
		 * Copies the file at `path` (relative to `cwd`, or absolute) and adds
		 * it to the run's index. Throws, with words for the agent, when the
		 * file is missing, is not a file, or is too large.
		 */
		async save(input: {
			runId: string;
			stepId: string;
			cwd: string;
			path: string;
			title?: string;
		}): Promise<Artifact> {
			const source = isAbsolute(input.path)
				? input.path
				: resolve(input.cwd, input.path);
			const info = await stat(source).catch(() => null);
			if (!info?.isFile()) {
				throw new Error(`No file at ${input.path}. Give the path of a file.`);
			}
			if (info.size > MAX_ARTIFACT_BYTES) {
				throw new Error(
					`${input.path} is larger than ${MAX_ARTIFACT_BYTES / 1024 / 1024} MB. Keep a smaller file.`,
				);
			}
			const name = basename(source);
			const artifact: Artifact = {
				id: randomUUID(),
				stepId: input.stepId,
				name,
				title: input.title ?? name,
				mediaType: Bun.file(source).type.split(";")[0] ?? "",
				size: info.size,
				savedAt: now(),
			};
			await mkdir(runDir(input.runId), { recursive: true });
			await copyFile(source, filePath(input.runId, artifact));
			await appendFile(indexPath(input.runId), `${JSON.stringify(artifact)}\n`);
			return artifact;
		},

		/** One artifact and where its copy is, or null when the run has none of that id. */
		async file(
			runId: string,
			artifactId: string,
		): Promise<{ artifact: Artifact; path: string } | null> {
			const artifact = (await list(runId)).find((one) => one.id === artifactId);
			return artifact ? { artifact, path: filePath(runId, artifact) } : null;
		},
	};
}
