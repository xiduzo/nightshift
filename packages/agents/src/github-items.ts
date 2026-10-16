/**
 * For Each items from GitHub: the sub-issues of one parent issue, read with
 * one GraphQL query per page through `gh api graphql`. Ported from
 * `fetch_issue` / `TREE_QUERY` in `night-shift.py`, with the issue body.
 *
 * Every argument goes to `gh` as an argv field (`-f` / `-F`), never through
 * a shell. The query only reads.
 */
import type { ListItem } from "@nightshift/flows";
import { type ProcessResult, runProcess } from "./process";
import type { GithubItemsInput } from "./types";

/** One parent issue with one page of its sub-issues and their "blocked by" links. */
export const SUB_ISSUES_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      number title
      subIssues(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number title body state url
          labels(first: 30) { nodes { name } }
          blockedBy(first: 50) { nodes { number state } }
        }
      }
    }
  }
}`;

type IssueState = "OPEN" | "CLOSED";

type SubIssueNode = {
	number: number;
	title: string;
	body?: string | null;
	state: IssueState;
	url: string;
	labels?: { nodes: ({ name: string } | null)[] } | null;
	blockedBy?: {
		nodes: ({ number: number; state: IssueState } | null)[];
	} | null;
};

type QueryResponse = {
	data?: {
		repository?: {
			issue?: {
				number: number;
				title: string;
				subIssues: {
					pageInfo: { hasNextPage: boolean; endCursor: string | null };
					nodes: (SubIssueNode | null)[];
				};
			} | null;
		} | null;
	};
	errors?: { message: string }[];
};

export type GithubItemsOptions = {
	/** Path or name of the `gh` executable. Defaults to `gh`. */
	gh?: string;
	/** Extra environment variables for `gh`. */
	env?: Record<string, string>;
};

async function runGh(
	args: string[],
	input: GithubItemsInput,
	options: GithubItemsOptions | undefined,
): Promise<string> {
	const result: ProcessResult = await runProcess(options?.gh ?? "gh", args, {
		cwd: input.cwd,
		signal: input.signal,
		...(options?.env ? { env: options.env } : {}),
	});
	if (result.code !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim() || "no output";
		throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${detail}`);
	}
	return result.stdout;
}

function parseJson<T>(text: string, what: string): T {
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(
			`${what} did not return JSON: ${text.trim().slice(0, 200)}`,
		);
	}
}

async function repoOf(
	input: GithubItemsInput,
	options: GithubItemsOptions | undefined,
): Promise<{ owner: string; name: string }> {
	const out = await runGh(
		["repo", "view", "--json", "owner,name"],
		input,
		options,
	);
	const repo = parseJson<{ owner?: { login?: string }; name?: string }>(
		out,
		"gh repo view",
	);
	const owner = repo.owner?.login;
	if (!owner || !repo.name) {
		throw new Error(`gh repo view gave no owner and name: ${out.trim()}`);
	}
	return { owner, name: repo.name };
}

const lower = (name: string) => name.toLowerCase();

/**
 * Reads the sub-issues of one parent issue as list items. An item's `value`
 * is `{ id, number, title, body, url, state, labels, parent: { number,
 * title }, dependsOn, done }`: `state` is GitHub's `OPEN` / `CLOSED`,
 * `labels` keep their case, and `dependsOn` holds the ids of the "blocked
 * by" issues. The item's own `dependsOn` also says whether each blocker is
 * closed. Items come in GitHub's sub-issue order; the engine orders them
 * blockers first. A sub-issue without `requireLabel`, or with one of
 * `skipLabels`, is left out. Closed sub-issues and those with a done label
 * are `done`. Pages through all sub-issues. Label names match without case,
 * as on GitHub. Throws when `gh` fails (its stderr is in
 * the message) or the parent issue does not exist; aborting the signal kills
 * `gh`.
 */
export async function readGithubItems(
	input: GithubItemsInput,
	options?: GithubItemsOptions,
): Promise<ListItem[]> {
	if (input.signal.aborted) throw new Error("Reading GitHub items was aborted");
	const { owner, name } = await repoOf(input, options);
	const required =
		input.requireLabel === undefined ? undefined : lower(input.requireLabel);
	const doneLabels = new Set(input.doneLabels.map(lower));
	const skipLabels = new Set((input.skipLabels ?? []).map(lower));

	const items: ListItem[] = [];
	let cursor: string | undefined;
	for (;;) {
		const args = [
			"api",
			"graphql",
			"-F",
			`number=${input.parent}`,
			"-f",
			`owner=${owner}`,
			"-f",
			`name=${name}`,
			...(cursor === undefined ? [] : ["-f", `cursor=${cursor}`]),
			"-f",
			`query=${SUB_ISSUES_QUERY}`,
		];
		const response = parseJson<QueryResponse>(
			await runGh(args, input, options),
			"gh api graphql",
		);
		if (response.errors?.length) {
			throw new Error(
				`gh api graphql: ${response.errors.map((e) => e.message).join("; ")}`,
			);
		}
		const parent = response.data?.repository?.issue;
		if (!parent) {
			throw new Error(`${owner}/${name} has no issue #${input.parent}.`);
		}
		for (const node of parent.subIssues.nodes) {
			if (!node) continue;
			const labels = (node.labels?.nodes ?? []).flatMap((label) =>
				label ? [label.name] : [],
			);
			const matching = labels.map(lower);
			if (required !== undefined && !matching.includes(required)) continue;
			if (matching.some((label) => skipLabels.has(label))) continue;
			const id = String(node.number);
			const dependsOn = (node.blockedBy?.nodes ?? []).flatMap((blocker) =>
				blocker
					? [{ id: String(blocker.number), done: blocker.state === "CLOSED" }]
					: [],
			);
			const done =
				node.state === "CLOSED" ||
				matching.some((label) => doneLabels.has(label));
			items.push({
				id,
				title: node.title,
				url: node.url,
				value: {
					id,
					number: node.number,
					title: node.title,
					body: node.body ?? "",
					url: node.url,
					state: node.state,
					labels,
					parent: { number: parent.number, title: parent.title },
					dependsOn: dependsOn.map((blocker) => blocker.id),
					done,
				},
				dependsOn,
				done,
			});
		}
		const page = parent.subIssues.pageInfo;
		if (!page.hasNextPage) return items;
		if (!page.endCursor || page.endCursor === cursor) {
			throw new Error(
				`gh api graphql: the sub-issues of #${input.parent} did not page on`,
			);
		}
		cursor = page.endCursor;
	}
}
