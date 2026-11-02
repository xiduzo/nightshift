import { randomUUID } from "node:crypto";
import {
	appendFile,
	copyFile,
	mkdir,
	readFile,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import type { AnswerFile } from "@nightshift/flows";
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
	/** `answer`: a person added it to the answer of the Gate `stepId`. Absent: an agent kept it. */
	from?: "answer";
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

		/**
		 * Keeps the files a person added to the answer of the Gate `stepId`,
		 * in the order given, as artifacts `from: "answer"`.
		 */
		async saveAnswer(input: {
			runId: string;
			stepId: string;
			files: readonly AnswerFile[];
		}): Promise<Artifact[]> {
			if (input.files.length === 0) return [];
			await mkdir(runDir(input.runId), { recursive: true });
			const kept: Artifact[] = [];
			for (const file of input.files) {
				const bytes = Buffer.from(file.content, "base64");
				const name = basename(file.name);
				const artifact: Artifact = {
					id: randomUUID(),
					stepId: input.stepId,
					name,
					title: name,
					mediaType:
						file.mediaType.split(";")[0] ||
						(Bun.file(name).type.split(";")[0] ?? ""),
					size: bytes.byteLength,
					savedAt: now(),
					from: "answer",
				};
				await writeFile(filePath(input.runId, artifact), bytes);
				kept.push(artifact);
			}
			await appendFile(
				indexPath(input.runId),
				kept.map((artifact) => `${JSON.stringify(artifact)}\n`).join(""),
			);
			return kept;
		},

		/**
		 * The files people added to the answers of the run's Gates, oldest
		 * first, with their bytes: what each agent session of the run gets.
		 * A name used twice gets the step's short id in front.
		 */
		async answerFiles(runId: string): Promise<AnswerFile[]> {
			const answers = (await list(runId)).filter(
				(artifact) => artifact.from === "answer",
			);
			const seen = new Set<string>();
			const files: AnswerFile[] = [];
			for (const artifact of answers) {
				const content = await readFile(filePath(runId, artifact)).catch(
					() => null,
				);
				if (content === null) continue;
				const name = seen.has(artifact.name)
					? `${artifact.stepId.slice(0, 8)}-${artifact.name}`
					: artifact.name;
				seen.add(name);
				files.push({
					name,
					mediaType: artifact.mediaType,
					content: content.toString("base64"),
				});
			}
			return files;
		},

		/**
		 * Writes the files of the run's answers where an agent session on this
		 * computer reads them: `<dataDir>/artifacts/<runId>/answers/`. A file
		 * already there is written again. Returns the folder and each path.
		 */
		async answerFolder(
			runId: string,
			files: readonly AnswerFile[],
		): Promise<{ dir: string; paths: string[] }> {
			const dir = join(runDir(runId), "answers");
			await mkdir(dir, { recursive: true });
			const paths: string[] = [];
			for (const file of files) {
				const path = join(dir, basename(file.name));
				await writeFile(path, Buffer.from(file.content, "base64"));
				paths.push(path);
			}
			return { dir, paths };
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
