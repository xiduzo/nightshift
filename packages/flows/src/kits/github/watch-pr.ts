import type { FlowInput } from "../../flow";

/**
 * The GraphQL query (`gh api graphql`) that reads one pull request: its
 * state, whether it is in the merge queue, its review, the checks of its
 * last commit and when it left the merge queue.
 */
const PR_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number url state isInMergeQueue reviewDecision headRefOid
      commits(last: 1) { nodes { commit { statusCheckRollup { state
        contexts(first: 100) { nodes { ... on CheckRun { name conclusion } ... on StatusContext { context state } } }
      } } } }
      timelineItems(last: 10, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT]) { nodes { ... on RemovedFromMergeQueueEvent { createdAt } } }
    }
  }
}`;

/**
 * The jq (`gh api --jq`) that picks the outcome. Merged and closed first.
 * In the merge queue, it waits for the queue. Removed from the queue since
 * the watch began (`WATCH_SINCE`): ejected. A failed check or a review that
 * asks for changes: red. All checks passed and no review that holds it
 * back: green. Anything else is pending, which the Wait does not list, so
 * it reads again later.
 */
const PR_FILTER = `.data.repository.pullRequest as $pr
| ($pr.commits.nodes[0].commit.statusCheckRollup // {}) as $rollup
| [($rollup.contexts.nodes // [])[] | select((.conclusion // .state // "") as $c | ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"] | any(. == $c)) | (.name // .context)] as $failed
| ([$pr.timelineItems.nodes[] | select(.createdAt >= $ENV.WATCH_SINCE)] | length > 0) as $ejected
| {
    outcome: (if $pr.state == "MERGED" then "merged"
      elif $pr.state == "CLOSED" then "closed"
      elif $pr.isInMergeQueue then "pending"
      elif $ejected then "ejected"
      elif ($failed | length) > 0 or $pr.reviewDecision == "CHANGES_REQUESTED" then "red"
      elif $rollup.state == "SUCCESS" and ($pr.reviewDecision // "APPROVED") == "APPROVED" then "green"
      else "pending" end),
    number: $pr.number,
    url: $pr.url,
    sha: $pr.headRefOid,
    review: ($pr.reviewDecision // ""),
    failed: $failed,
    failed_names: ($failed | join(", "))
  }`;

/** How often the Wait reads the pull request when no webhook wakes it. */
const EVERY_MINUTES = 10;
/** How long one watch lasts without an answer: a day. */
const TIMEOUT_MINUTES = 24 * 60;
/** How many webhooks may wake the watch before it gives up. */
const MAX_WAKES = 200;

/**
 * `kit:github/watch-pr`: waits until a pull request is green, red,
 * merged, closed or ejected from the merge queue (ADR 8). One Wait of
 * kind `any`: it reads the pull request with `gh` every 10 minutes, and
 * the signal `pr-changed` with the pull request's number as its key wakes
 * it at once. The command, not the webhook, picks the outcome: a signal
 * ends the wait `done`, and the kit waits again, which reads the pull
 * request first. `kit:github/wait-for-checks` stays for flows that only
 * need the checks of a commit.
 */
export const watchPrKit: FlowInput = {
	version: 7,
	description: `Waits until a pull request on GitHub is green, red, merged, closed or ejected from the merge queue. It reads the checks, the review and the merge queue every ${EVERY_MINUTES} minutes. To wake it as soon as GitHub reports a change, add a webhook schedule that sends the signal pr-changed with the pull request number as its key.`,
	inputs: [
		{
			name: "pr",
			type: "text",
			description:
				"The pull request: its number, address or branch. Empty: the one of the current branch.",
			default: "",
		},
	],
	outputs: [
		{
			name: "state",
			value: "{{watch.outcome}}",
			description: "green, red, merged, closed, ejected or timeout.",
		},
		{
			name: "number",
			value: "{{start.data.number}}",
			description: "The number of the pull request.",
		},
		{
			name: "url",
			value: "{{watch.data.url}}",
			description: "The address of the pull request.",
		},
		{
			name: "failed",
			value: "{{watch.data.failed}}",
			description: "The names of the checks that failed, as a list.",
		},
		{
			name: "review",
			value: "{{watch.data.review}}",
			description: "APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or empty.",
		},
	],
	start: "start",
	nodes: [
		{
			id: "start",
			type: "command",
			label: "Find the pull request",
			position: { x: 0, y: 0 },
			command: `# Finds the pull request, and notes when the watch began.
set -e
pr="{{pr}}"
number=$(gh pr view \${pr:+"$pr"} --json number --jq .number)
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"number": %s, "since": "%s"}\\n' "$number" "$since" > "$NS_OUTPUT"
echo "Watches pull request #$number from $since"`,
		},
		{
			id: "watch",
			type: "wait",
			label: "Watch the pull request",
			position: { x: 300, y: 0 },
			timeoutMinutes: TIMEOUT_MINUTES,
			until: {
				kind: "any",
				signal: { name: "pr-changed", key: "{{start.data.number}}" },
				command: {
					command: `# Reads the pull request, its checks, its review and the merge queue.
set -e
WATCH_SINCE="{{start.data.since}}"
export WATCH_SINCE
gh api graphql -F owner='{owner}' -F repo='{repo}' -F number="{{start.data.number}}" -f query='${PR_QUERY}' --jq '${PR_FILTER}' > "$NS_OUTPUT"
cat "$NS_OUTPUT"`,
					everyMinutes: EVERY_MINUTES,
				},
			},
			outcomes: [
				{
					name: "green",
					description: "All checks passed, and no review holds it back.",
					color: "green",
				},
				{
					name: "red",
					description: "A check failed, or a review asks for changes.",
					color: "red",
				},
				{ name: "merged", description: "It merged.", color: "violet" },
				{
					name: "closed",
					description: "It closed without a merge.",
					color: "gray",
				},
				{
					name: "ejected",
					description: "It left the merge queue without a merge.",
					color: "orange",
				},
			],
		},
		{
			id: "green",
			type: "end",
			position: { x: 600, y: -240 },
			status: "done",
			message: "Pull request #{{start.data.number}} is green",
		},
		{
			id: "red",
			type: "end",
			position: { x: 600, y: -120 },
			status: "failed",
			message:
				"Pull request #{{start.data.number}} needs work: {{watch.data.failed_names}}",
		},
		{
			id: "merged",
			type: "end",
			position: { x: 600, y: 0 },
			status: "done",
			message: "Pull request #{{start.data.number}} merged",
		},
		{
			id: "closed",
			type: "end",
			position: { x: 600, y: 120 },
			status: "failed",
			message: "Pull request #{{start.data.number}} closed without a merge",
		},
		{
			id: "ejected",
			type: "end",
			position: { x: 600, y: 240 },
			status: "failed",
			message:
				"Pull request #{{start.data.number}} left the merge queue without a merge",
		},
		{
			id: "not_found",
			type: "end",
			position: { x: 300, y: 240 },
			status: "failed",
			message: "Could not find the pull request on GitHub",
		},
		{
			id: "too_long",
			type: "end",
			position: { x: 300, y: -240 },
			status: "failed",
			message: "Pull request #{{start.data.number}} did not settle in time",
		},
	],
	edges: [
		{ id: "start-pass", from: "start", outcome: "pass", to: "watch" },
		{ id: "start-fail", from: "start", outcome: "fail", to: "not_found" },
		{ id: "watch-green", from: "watch", outcome: "green", to: "green" },
		{ id: "watch-red", from: "watch", outcome: "red", to: "red" },
		{ id: "watch-merged", from: "watch", outcome: "merged", to: "merged" },
		{ id: "watch-closed", from: "watch", outcome: "closed", to: "closed" },
		{ id: "watch-ejected", from: "watch", outcome: "ejected", to: "ejected" },
		{
			id: "watch-done-again",
			from: "watch",
			outcome: "done",
			to: "watch",
			max: MAX_WAKES,
		},
		{
			id: "watch-done-too-long",
			from: "watch",
			outcome: "done",
			to: "too_long",
			max: 1,
		},
		{
			id: "watch-timeout",
			from: "watch",
			outcome: "timeout",
			to: "too_long",
		},
	],
};
