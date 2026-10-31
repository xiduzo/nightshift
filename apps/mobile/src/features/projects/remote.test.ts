/// <reference types="bun" />
import { expect, test } from "bun:test";

import { remoteUrl } from "./remote";

test("remoteUrl opens the remote on the web, and is null without one", () => {
	expect(remoteUrl("github.com/acme/app")).toBe("https://github.com/acme/app");
	expect(remoteUrl("https://gitlab.example.com/group/app/")).toBe(
		"https://gitlab.example.com/group/app",
	);
	expect(remoteUrl(null)).toBeNull();
	expect(remoteUrl("  ")).toBeNull();
});
