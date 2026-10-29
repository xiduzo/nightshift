import type { FlowInput } from "../../flow";
import { JSON_STRING_FUNCTION } from "../shell";

/**
 * `kit:github/create-branch`: switches the run's copy of the project to a
 * new branch with a name a person reads. Plain git, so it needs no login.
 */
export const createBranchKit: FlowInput = {
	version: 7,
	description:
		"Switches to a new branch with the name you give. It starts at the current commit, or at a branch on GitHub. A branch that exists already is switched to as it is.",
	inputs: [
		{
			name: "name",
			type: "text",
			description: "The branch name, for example feature/123-login.",
			required: true,
		},
		{
			name: "from",
			type: "text",
			description:
				"A branch on GitHub to start from, for example main. Empty: the current commit.",
			default: "",
		},
	],
	outputs: [
		{
			name: "branch",
			value: "{{create.data.branch}}",
			description: "The branch the run is on now.",
		},
		{
			name: "created",
			value: "{{create.data.created}}",
			description: "true for a new branch, false when it existed.",
		},
		{
			name: "sha",
			value: "{{create.data.sha}}",
			description: "The commit the branch is on.",
		},
	],
	start: "create",
	nodes: [
		{
			id: "create",
			type: "command",
			label: "Create the branch",
			position: { x: 0, y: 0 },
			command: `# Switches to the branch: a new one from \`from\` or the current commit, or the one that exists.
set -e
${JSON_STRING_FUNCTION}
name="{{name}}"
from="{{from}}"
if ! git check-ref-format --branch "$name" >/dev/null 2>&1; then
	echo "\\"$name\\" is not a valid branch name."
	echo '{"outcome": "invalid-name"}' > "$NS_OUTPUT"
	exit 0
fi
created=true
if git show-ref --verify --quiet "refs/heads/$name"; then
	git switch "$name"
	created=false
elif [ -n "$from" ]; then
	git fetch origin "$from"
	git switch --no-track -c "$name" FETCH_HEAD
else
	git switch -c "$name"
fi
printf '{"branch": %s, "created": %s, "sha": %s}\\n' "$(json "$name")" "$created" "$(json "$(git rev-parse HEAD)")" > "$NS_OUTPUT"`,
			exits: [
				{ name: "created", code: 0, color: "green" },
				{ name: "invalid-name", code: "data", color: "red" },
				{ name: "fail", color: "red" },
			],
		},
		{
			id: "on_branch",
			type: "end",
			position: { x: 300, y: -120 },
			status: "done",
			message: "On the branch {{create.data.branch}}",
		},
		{
			id: "bad_name",
			type: "end",
			position: { x: 300, y: 0 },
			status: "failed",
			message: "{{name}} is not a valid branch name",
		},
		{
			id: "not_created",
			type: "end",
			position: { x: 300, y: 120 },
			status: "failed",
			message: "Could not switch to the branch {{name}}",
		},
	],
	edges: [
		{
			id: "create-created",
			from: "create",
			outcome: "created",
			to: "on_branch",
		},
		{
			id: "create-invalid-name",
			from: "create",
			outcome: "invalid-name",
			to: "bad_name",
		},
		{ id: "create-fail", from: "create", outcome: "fail", to: "not_created" },
	],
};
