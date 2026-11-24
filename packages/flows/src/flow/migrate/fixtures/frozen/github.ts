type GithubSource = {
	parent: string;
	requireLabel?: string;
	doneLabels?: string[];
	skipLabels?: string[];
};

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

function jqValue(value: string | string[] | null): string {
	return JSON.stringify(value).replace(/'/g, `'\\''`);
}
