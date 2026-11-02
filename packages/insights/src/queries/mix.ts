import { asc } from "drizzle-orm";

import type { InsightsDb } from "../client";
import {
	usageAgentCount,
	usageAgentShare,
	usageArch,
	usageEntry,
	usageHost,
	usageOs,
	usageStarter,
	usageVersion,
} from "../schema";
import { asNumber, asNumberOrNull, asText } from "./numbers";

export type Mix = {
	installs: number;
	/** Highest agent count each install reported. Installs that never reported one are absent. */
	agentsPerInstall: { agents: number; installs: number }[];
	/** Installs with two or more agents, divided by all installs. Null when there are no installs. */
	shareWithTwoOrMoreAgents: number | null;
	os: { os: string; installs: number }[];
	arch: { arch: string; installs: number }[];
	/** Desktop, server, or another entry. The first install event wins. */
	entry: { entry: string; installs: number }[];
	/** Whether the install is a Host. The first install event wins. */
	host: { host: boolean; installs: number }[];
	versions: { version: string; installs: number }[];
	/** Starter of the first flow. `starter` is null when that flow was not made from a starter. */
	firstFlowStarters: {
		starter: string | null;
		from: string | null;
		installs: number;
	}[];
};

export async function mix(db: InsightsDb): Promise<Mix> {
	const [share] = await db.select().from(usageAgentShare);
	const agents = await db
		.select()
		.from(usageAgentCount)
		.orderBy(asc(usageAgentCount.agents));
	const os = await db.select().from(usageOs).orderBy(asc(usageOs.os));
	const arch = await db.select().from(usageArch).orderBy(asc(usageArch.arch));
	const entry = await db
		.select()
		.from(usageEntry)
		.orderBy(asc(usageEntry.entry));
	const host = await db.select().from(usageHost).orderBy(asc(usageHost.host));
	const versions = await db
		.select()
		.from(usageVersion)
		.orderBy(asc(usageVersion.version));
	const starters = await db.select().from(usageStarter);
	return {
		installs: asNumber(share?.installs),
		agentsPerInstall: agents.map((row) => ({
			agents: asNumber(row.agents),
			installs: asNumber(row.installs),
		})),
		shareWithTwoOrMoreAgents: asNumberOrNull(share?.share),
		os: os.map((row) => ({ os: row.os, installs: asNumber(row.installs) })),
		arch: arch.map((row) => ({
			arch: row.arch,
			installs: asNumber(row.installs),
		})),
		entry: entry.map((row) => ({
			entry: row.entry,
			installs: asNumber(row.installs),
		})),
		host: host.map((row) => ({
			host: row.host,
			installs: asNumber(row.installs),
		})),
		versions: versions.map((row) => ({
			version: row.version,
			installs: asNumber(row.installs),
		})),
		firstFlowStarters: starters
			.map((row) => ({
				starter: asText(row.starter),
				from: asText(row.fromSource),
				installs: asNumber(row.installs),
			}))
			.sort((a, b) => (a.starter ?? "").localeCompare(b.starter ?? "")),
	};
}
