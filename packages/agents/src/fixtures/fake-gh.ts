/**
 * A fake `gh` / `git` for tests. Never talks to GitHub.
 *
 * Run through a wrapper script that sets `FAKE_TOOL` (`gh` or `git`). It
 * appends one JSON line per call to `$FAKE_LOG`: the tool, argv, stdin, cwd,
 * and pid. It answers with the first rule in the JSON file `$FAKE_RULES` whose
 * `tool` matches and whose `args` are a prefix of argv, after the rule's
 * `sleepMs`; with no match it exits 0 with no output.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

type Rule = {
	tool: string;
	args: string[];
	stdout?: string;
	stderr?: string;
	code?: number;
	sleepMs?: number;
};

const tool = process.env.FAKE_TOOL ?? "gh";
const argv = process.argv.slice(2);
const stdin = await Bun.stdin.text();

const log = process.env.FAKE_LOG;
if (log) {
	appendFileSync(
		log,
		`${JSON.stringify({ tool, argv, stdin, cwd: process.cwd(), pid: process.pid })}\n`,
	);
}

const rulesFile = process.env.FAKE_RULES;
const rules: Rule[] =
	rulesFile && existsSync(rulesFile)
		? JSON.parse(readFileSync(rulesFile, "utf8"))
		: [];
const rule = rules.find(
	(r) => r.tool === tool && r.args.every((arg, i) => argv[i] === arg),
);
if (rule?.sleepMs) await Bun.sleep(rule.sleepMs);
if (rule?.stdout) process.stdout.write(rule.stdout);
if (rule?.stderr) process.stderr.write(rule.stderr);
process.exit(rule?.code ?? 0);
