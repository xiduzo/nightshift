import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/api";
import { count, percent } from "@/shared/format";
import {
	Columns,
	EmptyNote,
	LoadState,
	Page,
	Section,
	Stat,
	Stats,
} from "@/shared/page";

/** Agents, systems, desktop or Host, and versions. */
export function MixPage() {
	const query = useQuery(orpc.mix.queryOptions({ input: {} }));
	const data = query.data;
	return (
		<Page
			title="Mix"
			detail="See agents, systems, and versions for each install."
		>
			<LoadState pending={query.isPending} error={query.isError}>
				{data ? (
					<>
						<Stats>
							<Stat label="Installs" value={count(data.installs)} />
							<Stat
								label="Two or more agents"
								value={percent(data.shareWithTwoOrMoreAgents)}
							/>
						</Stats>
						<Section title="Agents per install">
							{data.agentsPerInstall.length === 0 ? (
								<EmptyNote title="No install has reported an agent yet." />
							) : (
								<Columns
									headers={["Agents", "Installs"]}
									rows={data.agentsPerInstall.map((row) => [
										count(row.agents),
										count(row.installs),
									])}
								/>
							)}
						</Section>
						<Section title="Operating system">
							<Pair
								headers={["System", "Installs"]}
								rows={data.os.map((row) => [row.os, count(row.installs)])}
								empty="No system is recorded yet."
							/>
						</Section>
						<Section title="Architecture">
							<Pair
								headers={["Architecture", "Installs"]}
								rows={data.arch.map((row) => [row.arch, count(row.installs)])}
								empty="No architecture is recorded yet."
							/>
						</Section>
						<Section title="Entry">
							<Pair
								headers={["Entry", "Installs"]}
								rows={data.entry.map((row) => [row.entry, count(row.installs)])}
								empty="No entry is recorded yet."
							/>
						</Section>
						<Section title="Desktop or Host">
							<Pair
								headers={["Kind", "Installs"]}
								rows={data.host.map((row) => [
									row.host ? "Host" : "Desktop",
									count(row.installs),
								])}
								empty="No install is recorded yet."
							/>
						</Section>
						<Section title="Versions">
							<Pair
								headers={["Version", "Installs"]}
								rows={data.versions.map((row) => [
									row.version,
									count(row.installs),
								])}
								empty="No version is recorded yet."
							/>
						</Section>
						<Section title="First flow">
							{data.firstFlowStarters.length === 0 ? (
								<EmptyNote title="No flow is recorded yet." />
							) : (
								<Columns
									headers={["Starter", "From", "Installs"]}
									rows={data.firstFlowStarters.map((row) => [
										row.starter ?? "No starter",
										row.from ?? "No source",
										count(row.installs),
									])}
								/>
							)}
						</Section>
					</>
				) : null}
			</LoadState>
		</Page>
	);
}

function Pair({
	headers,
	rows,
	empty,
}: {
	headers: string[];
	rows: string[][];
	empty: string;
}) {
	if (rows.length === 0) return <EmptyNote title={empty} />;
	return <Columns headers={headers} rows={rows} />;
}
