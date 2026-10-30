import type { FlowInput } from "../../flow";
import { COUNT_FILES, folderInput, KNOWLEDGE_DEST, syncEnds } from "./shell";

/**
 * `kit:knowledge/github-wiki`: the wiki of a GitHub repository in the
 * project's knowledge, with plain git. The first sync clones it, a later
 * one takes the newest pages. A private wiki needs git signed in to GitHub.
 */
export const knowledgeGithubWikiKit: FlowInput = {
	version: 7,
	description:
		"Copies the wiki of a GitHub repository into the project's knowledge, and takes the newest pages on each later sync. A private wiki needs git signed in to GitHub.",
	inputs: [
		{
			name: "repo",
			label: "Repository",
			type: "text",
			description:
				"The repository, for example owner/name. Or the git address of any wiki.",
			required: true,
		},
		folderInput("wiki"),
	],
	start: "sync",
	...withSync(),
};

function withSync(): Pick<FlowInput, "nodes" | "edges" | "outputs"> {
	const ends = syncEnds("Wiki synced");
	return {
		...ends,
		nodes: [
			{
				id: "sync",
				type: "command",
				label: "Sync the wiki",
				position: { x: 0, y: 0 },
				command: String.raw`${KNOWLEDGE_DEST}
repo="{{repo}}"
case "$repo" in
	*://*|*@*) url="$repo" ;;
	*) url="https://github.com/$repo.wiki.git" ;;
esac
if [ -d "$dest/.git" ]; then
	git -C "$dest" fetch -q --depth 1 "$url"
	git -C "$dest" reset -q --hard FETCH_HEAD
else
	rm -rf "$dest"
	mkdir -p "$NS_KNOWLEDGE"
	git clone -q --depth 1 "$url" "$dest"
fi
${COUNT_FILES}`,
				exits: [
					{ name: "synced", code: 0, color: "green" },
					{ name: "fail", color: "red" },
				],
			},
			...(ends.nodes ?? []),
		],
	};
}
