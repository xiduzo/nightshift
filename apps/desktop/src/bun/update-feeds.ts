/**
 * Where the app finds its updates. Both feeds are GitHub Releases of this
 * repository: tagged versions are the latest full release, nightly builds one
 * rolling `nightly` prerelease. A nightly build is an Electrobun `stable`
 * build with another feed, so one installed app can switch between them.
 */
const RELEASES = "https://github.com/xiduzo/nightshift/releases";

export type UpdateFeed = "stable" | "nightly";

export const UPDATE_FEEDS: Record<UpdateFeed, string> = {
	stable: `${RELEASES}/latest/download`,
	nightly: `${RELEASES}/download/nightly`,
};

/** The feed a build was made for, from its baked-in base URL. */
export function feedOf(baseUrl: string): UpdateFeed {
	return baseUrl === UPDATE_FEEDS.nightly ? "nightly" : "stable";
}
