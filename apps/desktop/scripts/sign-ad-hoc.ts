/**
 * Electrobun `postWrap` hook: seals an unsigned macOS app with an ad-hoc
 * signature.
 *
 * Without Apple credentials, Electrobun leaves only the linker's signature on
 * the launcher. The bundle itself has no seal. macOS then calls a downloaded
 * copy "damaged" and offers no way to open it. An ad-hoc seal turns that into
 * the usual "Open Anyway" step in Privacy & Security (docs/releasing.md).
 *
 * A build with a Developer ID skips this: Electrobun signs it.
 */
const bundle = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH;

if (
	process.env.ELECTROBUN_OS === "macos" &&
	!process.env.ELECTROBUN_DEVELOPER_ID &&
	bundle
) {
	const sign = Bun.spawnSync(
		["codesign", "--force", "--deep", "--sign", "-", bundle],
		{ stdout: "inherit", stderr: "inherit" },
	);
	if (sign.exitCode !== 0) {
		throw new Error(`codesign failed for ${bundle}`);
	}
	const verify = Bun.spawnSync(
		["codesign", "--verify", "--deep", "--strict", bundle],
		{ stdout: "inherit", stderr: "inherit" },
	);
	if (verify.exitCode !== 0) {
		throw new Error(`The ad-hoc signature of ${bundle} is not valid`);
	}
	console.log(`sign-ad-hoc: sealed ${bundle}`);
}
