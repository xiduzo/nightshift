import type { FlowInput } from "../../document";

/**
 * The jq (`gh api --jq`) that sums up the check runs of one commit: the
 * names that still run and the names that failed, and the outcome for
 * the `look` step. No check run yet counts as pending: CI may not have
 * started.
 */
const CHECKS_FILTER = `[.check_runs[] | {name, status, conclusion}] as $runs
| ($runs | map(select(.status != "completed") | .name)) as $pending
| ($runs | map(select(.status == "completed" and (.conclusion as $c | ["failure", "timed_out", "cancelled", "action_required", "startup_failure"] | any(. == $c))) | .name)) as $failed
| {
    outcome: (if ($runs | length) == 0 or ($pending | length) > 0 then "pending" elif ($failed | length) > 0 then "failing" else "passed" end),
    total: ($runs | length),
    pending: $pending,
    failed: $failed,
    failed_names: ($failed | join(", "))
  }`;

/** How long one wait for the signal lasts before the checks are read again. */
const WAIT_MINUTES = 10;
/** How many waits before the kit gives up: 18 times 10 minutes is 3 hours. */
const MAX_WAITS = 18;

/**
 * `kit:github/wait-for-checks`: waits until the checks of a commit on
 * GitHub are done. It reads them with `gh`, then waits for the signal
 * `ci-done` with the commit as its key. A webhook schedule sends that
 * signal when GitHub reports a finished check suite. Without one, each
 * wait times out and the kit reads the checks again: a slower poll.
 */
export const waitForChecksKit: FlowInput = {
	version: 7,
	description: `Waits until the checks of a commit on GitHub are done, for at most ${(WAIT_MINUTES * MAX_WAITS) / 60} hours. Failed checks end it as failed. To wake it as soon as GitHub is done, add a webhook schedule for check suites that sends the signal ci-done with the commit as its key: event.body.check_suite.head_sha. Without one, it looks again every ${WAIT_MINUTES} minutes.`,
	inputs: [
		{
			name: "ref",
			type: "text",
			description:
				"The commit to wait for: a commit, a branch or a tag. Empty: the current commit.",
			default: "",
		},
	],
	outputs: [
		{
			name: "state",
			value: "{{look.data.outcome}}",
			description: "passed, failing or pending.",
		},
		{
			name: "sha",
			value: "{{look.data.sha}}",
			description: "The commit whose checks it read.",
		},
		{
			name: "failed",
			value: "{{look.data.failed}}",
			description: "The names of the checks that failed, as a list.",
		},
		{
			name: "total",
			value: "{{look.data.total}}",
			description: "How many checks ran.",
		},
	],
	start: "look",
	nodes: [
		{
			id: "look",
			type: "command",
			label: "Read the checks",
			position: { x: 0, y: 0 },
			command: `# Reads the check runs of the commit on GitHub.
set -e
ref="{{ref}}"
if printf '%s' "$ref" | grep -Eq '^[0-9a-f]{40}$'; then
	sha="$ref"
else
	sha=$(git rev-parse --verify "\${ref:-HEAD}^{commit}")
fi
checks=$(gh api "repos/{owner}/{repo}/commits/$sha/check-runs?per_page=100" --jq '${CHECKS_FILTER}')
printf '{"sha": "%s", %s\\n' "$sha" "\${checks#\\{}" > "$NS_OUTPUT"
echo "Checks of $sha: $checks"`,
			exits: [
				{ name: "passed", code: "data", color: "green" },
				{ name: "failing", code: "data", color: "red" },
				{ name: "pending", code: "data", color: "amber" },
				{ name: "fail", color: "red" },
			],
		},
		{
			id: "wait",
			type: "wait",
			label: "Wait for CI",
			position: { x: 300, y: 160 },
			timeoutMinutes: WAIT_MINUTES,
			until: { kind: "signal", name: "ci-done", key: "{{look.data.sha}}" },
		},
		{
			id: "passed",
			type: "end",
			position: { x: 300, y: -240 },
			status: "done",
			message: "All {{look.data.total}} checks passed",
		},
		{
			id: "failing",
			type: "end",
			position: { x: 300, y: -120 },
			status: "failed",
			message: "Checks failed: {{look.data.failed_names}}",
		},
		{
			id: "unread",
			type: "end",
			position: { x: 300, y: 0 },
			status: "failed",
			message: "Could not read the checks on GitHub",
		},
		{
			id: "too_long",
			type: "end",
			position: { x: 600, y: 0 },
			status: "failed",
			message: `The checks did not finish in ${(WAIT_MINUTES * MAX_WAITS) / 60} hours`,
		},
	],
	edges: [
		{ id: "look-passed", from: "look", outcome: "passed", to: "passed" },
		{ id: "look-failing", from: "look", outcome: "failing", to: "failing" },
		{ id: "look-fail", from: "look", outcome: "fail", to: "unread" },
		{
			id: "look-pending-wait",
			from: "look",
			outcome: "pending",
			to: "wait",
			max: MAX_WAITS,
		},
		{
			id: "look-pending-too-long",
			from: "look",
			outcome: "pending",
			to: "too_long",
			max: 1,
		},
		{ id: "wait-done-look", from: "wait", outcome: "done", to: "look" },
		{ id: "wait-timeout-look", from: "wait", outcome: "timeout", to: "look" },
	],
};
