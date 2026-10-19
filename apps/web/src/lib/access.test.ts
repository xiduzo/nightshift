import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/client";

import {
	accessRedirect,
	isOutsideApp,
	isSignInRequired,
	safeRedirect,
} from "./access";

const remote = {
	signedIn: false,
	thisComputer: false,
	twoFactor: { setUpNeeded: false },
};
const at = (href: string) => ({ pathname: href.split("?")[0] ?? href, href });

describe("who may see the app in this browser", () => {
	test("a signed-out browser elsewhere signs in, then comes back", () => {
		expect(accessRedirect(remote, at("/runs/abc?tab=steps"))).toEqual({
			to: "/login",
			redirect: "/runs/abc?tab=steps",
		});
		expect(accessRedirect(remote, at("/"))).toEqual({
			to: "/login",
			redirect: undefined,
		});
	});

	test("signing in and an invitation's link stay open when signed out", () => {
		expect(accessRedirect(remote, at("/login"))).toBeNull();
		expect(accessRedirect(remote, at("/invite/inv-1"))).toBeNull();
		// The setup page sends a signed-out browser to sign in itself.
		expect(accessRedirect(remote, at("/two-factor"))).toBeNull();
	});

	test("on this computer nobody signs in", () => {
		const local = { ...remote, thisComputer: true };
		expect(accessRedirect(local, at("/"))).toBeNull();
		expect(accessRedirect(local, at("/settings"))).toBeNull();
	});

	test("a signed-in browser sees the app", () => {
		expect(accessRedirect({ ...remote, signedIn: true }, at("/"))).toBeNull();
	});

	test("a session without the required two-factor sets it up first", () => {
		const setUp = {
			...remote,
			signedIn: true,
			twoFactor: { setUpNeeded: true },
		};
		expect(accessRedirect(setUp, at("/members"))).toEqual({
			to: "/two-factor",
			redirect: "/members",
		});
		expect(accessRedirect(setUp, at("/invite/inv-1"))).toEqual({
			to: "/two-factor",
			redirect: "/invite/inv-1",
		});
		expect(accessRedirect(setUp, at("/two-factor"))).toBeNull();
		expect(accessRedirect(setUp, at("/login"))).toBeNull();
	});

	test("pages without the sidebar", () => {
		expect(isOutsideApp("/login")).toBe(true);
		expect(isOutsideApp("/invite/inv-1")).toBe(true);
		expect(isOutsideApp("/two-factor")).toBe(true);
		expect(isOutsideApp("/")).toBe(false);
		expect(isOutsideApp("/runs/abc")).toBe(false);
	});
});

describe("the page to come back to", () => {
	test("a page of this app", () => {
		expect(safeRedirect("/runs/abc?tab=steps#log")).toBe(
			"/runs/abc?tab=steps#log",
		);
		expect(safeRedirect("/")).toBe("/");
	});

	test("never another site", () => {
		expect(safeRedirect("//evil.example")).toBeUndefined();
		expect(safeRedirect("/\\evil.example")).toBeUndefined();
		expect(safeRedirect("https://evil.example/")).toBeUndefined();
		expect(safeRedirect("javascript:alert(1)")).toBeUndefined();
		expect(safeRedirect("runs/abc")).toBeUndefined();
		expect(safeRedirect(undefined)).toBeUndefined();
		expect(safeRedirect(42)).toBeUndefined();
	});

	test("never the sign-in or setup pages themselves", () => {
		expect(safeRedirect("/login")).toBeUndefined();
		expect(safeRedirect("/login?redirect=/")).toBeUndefined();
		expect(safeRedirect("/two-factor")).toBeUndefined();
	});
});

describe("the refusal of a call without a session", () => {
	test("is told apart from other errors", () => {
		expect(
			isSignInRequired(
				new ORPCError("UNAUTHORIZED", {
					message: "Sign in to use Night Shift.",
				}),
			),
		).toBe(true);
		expect(isSignInRequired({ code: "UNAUTHORIZED", status: 401 })).toBe(true);
		expect(isSignInRequired({ code: "TWO_FACTOR_REQUIRED" })).toBe(false);
		expect(isSignInRequired({ code: "FORBIDDEN" })).toBe(false);
		expect(isSignInRequired(new Error("Sign in to use Night Shift."))).toBe(
			false,
		);
		expect(isSignInRequired(null)).toBe(false);
	});
});
