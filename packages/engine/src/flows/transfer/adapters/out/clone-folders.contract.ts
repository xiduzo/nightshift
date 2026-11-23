import { describe, expect, test } from "bun:test";
import type { CloneFolders } from "../../application/ports";

/** A Clone with no `.nightshift/` folder yet. */
export type CloneFoldersSetup = {
	folders: CloneFolders;
	repoPath: string;
	/** Writes a file of the folder, relative to it (`flows/build.json`). */
	write(path: string, text: string): Promise<void>;
	/** Git tracks these files of the folder. */
	track(paths: readonly string[]): Promise<void>;
	/** The files of the folder now, sorted. Null when it is gone. */
	files(): Promise<string[] | null>;
	close(): Promise<void>;
};

/** What every `CloneFolders` adapter does. */
export function cloneFoldersContract(
	name: string,
	setup: () => Promise<CloneFoldersSetup>,
): void {
	describe(`CloneFolders (${name})`, () => {
		test("reads no folder as null", async () => {
			const { folders, repoPath, close } = await setup();
			expect(await folders.read(repoPath)).toBeNull();
			await close();
		});

		test("reads the flows, the schedules, the profiles and what it does not know", async () => {
			const clone = await setup();
			await clone.write("flows/build.json", '{"nodes":[]}');
			await clone.write("flows/broken.json", "{");
			await clone.write("schedules.json", "[]");
			await clone.write("profiles.json", "{}");
			await clone.write(".DS_Store", "litter");
			await clone.write("notes.txt", "mine");
			const folder = await clone.folders.read(clone.repoPath);
			expect([...(folder?.flows.keys() ?? [])].sort()).toEqual([
				"broken",
				"build",
			]);
			expect(folder?.flows.get("build")).toEqual({ json: { nodes: [] } });
			expect(folder?.flows.get("broken")).toHaveProperty("jsonError");
			expect(folder?.schedules).toEqual({ json: [] });
			expect(folder?.profiles).toEqual({ json: {} });
			expect(folder?.files.map((file) => file.path).sort()).toEqual([
				".DS_Store",
				"flows/broken.json",
				"flows/build.json",
				"profiles.json",
				"schedules.json",
			]);
			expect(folder?.unknown).toEqual(["notes.txt"]);
			await clone.close();
		});

		test("tells how much of the folder git tracks", async () => {
			const clone = await setup();
			await clone.write("flows/build.json", "{}");
			await clone.write("schedules.json", "[]");
			const folder = await clone.folders.read(clone.repoPath);
			if (!folder) throw new Error("no folder");
			expect(await clone.folders.tracked(clone.repoPath, folder)).toBe(
				"untracked",
			);
			await clone.track(["flows/build.json"]);
			expect(await clone.folders.tracked(clone.repoPath, folder)).toBe(
				"partial",
			);
			await clone.track(["schedules.json"]);
			expect(await clone.folders.tracked(clone.repoPath, folder)).toBe(
				"tracked",
			);
			await clone.close();
		});

		test("removes the files it read, and the folder", async () => {
			const clone = await setup();
			await clone.write("flows/build.json", "{}");
			await clone.write("schedules.json", "[]");
			const folder = await clone.folders.read(clone.repoPath);
			if (!folder) throw new Error("no folder");
			expect(await clone.folders.remove(clone.repoPath, folder)).toBe(true);
			expect(await clone.files()).toBeNull();
			await clone.close();
		});

		test("keeps a file that changed since it was read, and its folder", async () => {
			const clone = await setup();
			await clone.write("flows/build.json", "{}");
			await clone.write("schedules.json", "[]");
			const folder = await clone.folders.read(clone.repoPath);
			if (!folder) throw new Error("no folder");
			await clone.write("flows/build.json", '{"changed":true}');
			expect(await clone.folders.remove(clone.repoPath, folder)).toBe(false);
			expect(await clone.files()).toEqual(["flows/build.json"]);
			await clone.close();
		});
	});
}
