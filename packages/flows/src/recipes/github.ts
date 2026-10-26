/**
 * Recipes: ready-made list sources for a Call node with `each`. The
 * assistant shows one as an example of a source command, and
 * `migrateFlow` turns an old `github` source into one.
 */

/**
 * The GitHub source the engine read itself, before the List Source had
 * three adapters: the sub-issues of one parent issue.
 */
type GithubSource = {
	parent: string;
	requireLabel?: string;
	doneLabels?: string[];
	skipLabels?: string[];
};

/** One parent issue with its sub-issues and their "blocked by" links. GitHub allows 100 sub-issues per issue. */
const SUB_ISSUES_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      number title
      subIssues(first: 100) {
        nodes {
          number title body state url
          labels(first: 30) { nodes { name } }
          blockedBy(first: 50) { nodes { number state } }
        }
      }
    }
  }
}`;

/**
 * The jq that turns the query's answer into list items. The first line holds
 * the filters, so a person can edit them in place: `$require` (a label a
 * sub-issue must have, or null), `$skip` (labels that leave a sub-issue
 * out) and `$done` (labels that count as done, like a closed issue). Label
 * names in lowercase.
 */
const SUB_ISSUES_FILTER = `.data.repository.issue as $parent
| [ $parent.subIssues.nodes[]
    | (.labels.nodes | map(.name | ascii_downcase)) as $labels
    | select($require == null or any($labels[]; . == $require))
    | select(any($labels[]; IN($skip[])) | not)
    | { id: (.number | tostring), number, title, body: (.body // ""), url, state,
        labels: [.labels.nodes[].name],
        parent: { number: $parent.number, title: $parent.title },
        dependsOn: [ .blockedBy.nodes[] | { id: (.number | tostring), done: (.state == "CLOSED") } ],
        done: (.state == "CLOSED" or any($labels[]; IN($done[]))) } ]`;

/**
 * A source command that prints the sub-issues of one GitHub issue as list
 * items, through `gh api graphql` in the worktree's repository. Each item
 * is `{ id, number, title, body, url, state, labels, parent: { number,
 * title }, dependsOn: [{ id, done }], done }`: `id` is the issue number as
 * text, `dependsOn` comes from the "blocked by" links, and `done` is a
 * closed issue or one of `doneLabels`. A sub-issue without `requireLabel`
 * or with one of `skipLabels` is left out. Labels match without case.
 * `parent` is a template for the issue number, for example `{{epic}}`: the
 * command adapter passes it as an environment variable.
 */
export function githubSubIssuesCommand(source: GithubSource): string {
	const lower = (labels: readonly string[]) =>
		labels.map((label) => label.toLowerCase());
	const knobs = [
		`${jqValue(source.requireLabel?.toLowerCase() ?? null)} as $require`,
		`${jqValue(lower(source.skipLabels ?? []))} as $skip`,
		`${jqValue(lower(source.doneLabels ?? []))} as $done`,
	].join(" | ");
	return [
		`gh api graphql -F owner='{owner}' -F name='{repo}' -F number="${source.parent}" -f query='`,
		`${SUB_ISSUES_QUERY}' --jq '`,
		`${knobs}`,
		`| ${SUB_ISSUES_FILTER}'`,
	].join("\n");
}

/** A jq literal inside the single-quoted shell argument: JSON, with any `'` escaped for the shell. */
function jqValue(value: string | string[] | null): string {
	return JSON.stringify(value).replace(/'/g, `'\\''`);
}
