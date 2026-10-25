/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as auth from "../auth.js";
import type * as checks_brands from "../checks/brands.js";
import type * as checks_claimedIdentity from "../checks/claimedIdentity.js";
import type * as checks_headerAuth from "../checks/headerAuth.js";
import type * as checks_index from "../checks/index.js";
import type * as checks_injection from "../checks/injection.js";
import type * as checks_intel from "../checks/intel.js";
import type * as checks_linkAudit from "../checks/linkAudit.js";
import type * as checks_parse from "../checks/parse.js";
import type * as checks_pressure from "../checks/pressure.js";
import type * as checks_relationship from "../checks/relationship.js";
import type * as checks_ruleLevel from "../checks/ruleLevel.js";
import type * as checks_text from "../checks/text.js";
import type * as checks_types from "../checks/types.js";
import type * as contract from "../contract.js";
import type * as crons from "../crons.js";
import type * as families from "../families.js";
import type * as feed from "../feed.js";
import type * as gmailActions from "../gmailActions.js";
import type * as gmailConnect from "../gmailConnect.js";
import type * as gmailImport from "../gmailImport.js";
import type * as googleAuth from "../googleAuth.js";
import type * as http from "../http.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_explain from "../lib/explain.js";
import type * as lib_gmailApi from "../lib/gmailApi.js";
import type * as lib_history from "../lib/history.js";
import type * as lib_oauth from "../lib/oauth.js";
import type * as lib_orgDirectory from "../lib/orgDirectory.js";
import type * as lib_parentNote from "../lib/parentNote.js";
import type * as lib_sampleHistory from "../lib/sampleHistory.js";
import type * as lib_signInFinder from "../lib/signInFinder.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as mailWatch from "../mailWatch.js";
import type * as repair from "../repair.js";
import type * as signInPages from "../signInPages.js";
import type * as turnOff from "../turnOff.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  auth: typeof auth;
  "checks/brands": typeof checks_brands;
  "checks/claimedIdentity": typeof checks_claimedIdentity;
  "checks/headerAuth": typeof checks_headerAuth;
  "checks/index": typeof checks_index;
  "checks/injection": typeof checks_injection;
  "checks/intel": typeof checks_intel;
  "checks/linkAudit": typeof checks_linkAudit;
  "checks/parse": typeof checks_parse;
  "checks/pressure": typeof checks_pressure;
  "checks/relationship": typeof checks_relationship;
  "checks/ruleLevel": typeof checks_ruleLevel;
  "checks/text": typeof checks_text;
  "checks/types": typeof checks_types;
  contract: typeof contract;
  crons: typeof crons;
  families: typeof families;
  feed: typeof feed;
  gmailActions: typeof gmailActions;
  gmailConnect: typeof gmailConnect;
  gmailImport: typeof gmailImport;
  googleAuth: typeof googleAuth;
  http: typeof http;
  "lib/env": typeof lib_env;
  "lib/explain": typeof lib_explain;
  "lib/gmailApi": typeof lib_gmailApi;
  "lib/history": typeof lib_history;
  "lib/oauth": typeof lib_oauth;
  "lib/orgDirectory": typeof lib_orgDirectory;
  "lib/parentNote": typeof lib_parentNote;
  "lib/sampleHistory": typeof lib_sampleHistory;
  "lib/signInFinder": typeof lib_signInFinder;
  "lib/tokens": typeof lib_tokens;
  mailWatch: typeof mailWatch;
  repair: typeof repair;
  signInPages: typeof signInPages;
  turnOff: typeof turnOff;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
