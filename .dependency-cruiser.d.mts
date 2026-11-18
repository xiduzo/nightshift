import type { IConfiguration } from "dependency-cruiser";

/** The server packages: the ones whose capabilities get rings. */
export declare const SERVER_PACKAGES: string[];

/** What the rules call a test, as patterns of a path. As `isTest` of `scripts/check-layers.ts`. */
export declare const TESTS: string[];

/** The kernel of a package: the pure mechanisms its rings may import. */
export declare const PACKAGE_KERNEL: Record<string, string[]>;

declare const ringRules: IConfiguration;
export default ringRules;
