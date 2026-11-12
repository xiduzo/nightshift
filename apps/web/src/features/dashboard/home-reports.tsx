import { Link } from "@tanstack/react-router";
import { FileTextIcon } from "lucide-react";
import { END_STATUS_LABEL } from "@/features/flows";
import { ReportPreview, reportLink } from "@/features/runs";
import type { NightRange } from "@/shared/api";
import { formatRelative, useNow } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { Lane, LaneRow, Title } from "./home-lanes";
import { type LatestReports, noReportsText } from "./reports";

/**
 * What came out: the newest report of each flow over the page's range,
 * under the lanes. A row opens the report on its run's page and shows its
 * start on hover. Nothing shows for an older Host, which sends no reports.
 */
export function HomeReports({
	reports,
	range,
}: {
	/** Undefined while the numbers load. Null: the Host sends no reports. */
	reports: LatestReports | null | undefined;
	range: NightRange;
}) {
	const now = useNow();
	if (reports === null) return null;
	return (
		<Lane
			icon={<FileTextIcon className="text-muted-foreground" />}
			title="Latest reports"
			count={reports?.count ?? 0}
			isLoading={reports === undefined}
			empty={noReportsText(range)}
			hidden={reports?.hidden ?? 0}
			where="on the Flows page of each project"
		>
			{(reports?.rows ?? []).map((report) => (
				<LaneRow
					key={report.key}
					link={<Link {...reportLink(report)} />}
					title={<Title group={report.group} name={report.title} />}
					meta={
						<LocalTime at={report.endedAt}>
							{formatRelative(report.endedAt, now)}
						</LocalTime>
					}
					detail={
						<>
							<p className="font-medium">
								{END_STATUS_LABEL[report.result]} ·{" "}
								<LocalTime at={report.endedAt}>
									{formatRelative(report.endedAt, now)}
								</LocalTime>
							</p>
							<ReportPreview text={report.excerpt} more={report.more} />
						</>
					}
				/>
			))}
		</Lane>
	);
}
