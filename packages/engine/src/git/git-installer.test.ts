import { describe, expect, test } from "bun:test";
import { GIT_DOWNLOAD_URL, systemGitInstaller } from "./git";

describe("systemGitInstaller", () => {
	const which =
		(...found: string[]) =>
		(name: string) =>
			found.includes(name) ? `/bin/${name}` : null;

	test("macOS opens Apple's installer", async () => {
		const ran: string[][] = [];
		const installer = systemGitInstaller({
			platform: "darwin",
			which: which("xcode-select"),
			run: async (argv) => {
				ran.push(argv);
				return { exitCode: 0, stderr: "" };
			},
		});
		expect(await installer.install()).toEqual({ kind: "started" });
		expect(ran).toEqual([["xcode-select", "--install"]]);
	});

	test("macOS falls back to brew when the installer does not start", async () => {
		const installer = systemGitInstaller({
			platform: "darwin",
			which: which("xcode-select", "brew"),
			run: async () => ({ exitCode: 1, stderr: "already installed" }),
		});
		expect(await installer.install()).toEqual({
			kind: "command",
			command: "brew install git",
		});
	});

	test("Linux returns the command and never runs it", async () => {
		const installer = systemGitInstaller({
			platform: "linux",
			which: which("dnf"),
			run: async () => {
				throw new Error("must not run");
			},
		});
		expect(await installer.install()).toEqual({
			kind: "command",
			command: "sudo dnf install git",
		});
	});

	test("Windows uses winget, else the download page", async () => {
		const run = async () => ({ exitCode: 0, stderr: "" });
		expect(
			await systemGitInstaller({
				platform: "win32",
				which: which("winget"),
				run,
			}).install(),
		).toEqual({
			kind: "command",
			command: "winget install --id Git.Git -e --source winget",
		});
		expect(
			await systemGitInstaller({
				platform: "win32",
				which: which(),
				run,
			}).install(),
		).toEqual({ kind: "manual", url: GIT_DOWNLOAD_URL });
	});
});
