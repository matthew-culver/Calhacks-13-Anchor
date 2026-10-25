// A7: the AI investigator. For each suspicious email, a Claude agent with web search and
// web fetch checks the sender and every link, appending plain-language steps the kid's screen
// shows live, then concludes. Safety rules live in lib/investigator.ts (decideLevel).
//
// Privacy: the email body is never stored or passed through scheduler args. For familiar
// senders the action re-reads the email from Gmail, in memory, so the agent can judge
// "does this sound like them?" (and then may only raise, never lower).

import Anthropic from "@anthropic-ai/sdk";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { parseEml } from "./checks/index";
import { checkResult, investigationStep, linkFinding, verdictLevel } from "./contract";
import { accessTokenFor } from "./googleAuth";
import { cleanExplanation } from "./lib/explain";
import { gmailRequest } from "./lib/gmailApi";
import {
  buildBrief,
  decideLevel,
  type Facts,
  fallbackConclusion,
  MAX_STEPS,
  MODEL,
  officialSource,
  pageConfirmsSender,
  parseOutput,
  plain,
  SYSTEM,
} from "./lib/investigator";
import { cleanUrl, probeLink } from "./lib/linkProbe";
import schema from "./schema";

const MAX_PER_HOUR = 20; // per family; beyond this, deterministic checks only
const MAX_PROBES = 5;
const AGENT_TIMEOUT_MS = 120_000;
const MAX_TURNS = 4; // pause_turn resumptions

const factsValidator = v.object({
  ruleLevel: verdictLevel,
  sender: v.object({ name: v.string(), address: v.string(), domain: v.string(), replyTo: v.optional(v.string()) }),
  claimedOrg: v.optional(v.string()),
  officialDomains: v.optional(v.array(v.string())),
  familiar: v.boolean(),
  checks: v.array(checkResult),
  links: v.array(
    v.object({
      shownText: v.string(),
      href: v.string(), // already cleaned: scheme + host + path, no query string
      site: v.string(),
      cls: v.union(v.literal("established"), v.literal("user_content"), v.literal("unknown")),
      ageDays: v.optional(v.number()),
      listedDangerous: v.optional(v.boolean()),
    }),
  ),
});

// ---------- database ----------

export const start = internalMutation({
  args: { verdictId: v.id("verdicts"), steps: v.array(investigationStep) },
  returns: v.union(v.null(), v.id("investigations")),
  handler: async (ctx, { verdictId, steps }) => {
    const verdict = await ctx.db.get(verdictId);
    if (!verdict) return null;
    const family = await ctx.db.get(verdict.familyId);
    if (!family || family.status === "off") return null;
    const existing = await ctx.db.query("investigations").withIndex("by_verdict", (q) => q.eq("verdictId", verdictId)).first();
    if (existing) return null; // one investigation per email
    const recent = await ctx.db
      .query("investigations")
      .withIndex("by_family", (q) => q.eq("familyId", family._id))
      .order("desc")
      .take(MAX_PER_HOUR + 1);
    if (recent.filter((i) => i.startedAt > Date.now() - 3600_000).length >= MAX_PER_HOUR) return null;
    return await ctx.db.insert("investigations", {
      familyId: family._id,
      verdictId,
      status: "running",
      startedAt: Date.now(),
      steps: steps.slice(0, MAX_STEPS),
    });
  },
});

export const addSteps = internalMutation({
  args: { investigationId: v.id("investigations"), steps: v.array(investigationStep) },
  returns: v.null(),
  handler: async (ctx, { investigationId, steps }) => {
    const inv = await ctx.db.get(investigationId);
    if (!inv || inv.status !== "running") return null;
    await ctx.db.patch(investigationId, { steps: [...inv.steps, ...steps].slice(0, MAX_STEPS) });
    return null;
  },
});

const conclusionValidator = v.object({
  level: verdictLevel,
  summary: v.string(),
  sender: v.object({
    verdict: v.union(v.literal("genuine"), v.literal("unverified"), v.literal("impostor")),
    reason: v.string(),
  }),
  links: v.array(linkFinding),
  suggestion: v.optional(v.string()),
});

/** Record the conclusion and carry it out: raise (hold/label) or, rarely, clear and release. */
export const finish = internalMutation({
  args: {
    investigationId: v.id("investigations"),
    status: v.union(v.literal("done"), v.literal("failed")),
    conclusion: conclusionValidator,
    sources: v.array(v.object({ title: v.string(), url: v.string() })),
    cleared: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { investigationId, status, conclusion, sources, cleared }) => {
    const inv = await ctx.db.get(investigationId);
    if (!inv || inv.status !== "running") return null;
    await ctx.db.patch(investigationId, { status, conclusion, sources: sources.slice(0, 8), finishedAt: Date.now() });

    const verdict = await ctx.db.get(inv.verdictId);
    const family = verdict && (await ctx.db.get(verdict.familyId));
    if (!verdict || !family || family.status === "off") return null;
    const item = await ctx.db.query("feedItems").withIndex("by_verdict", (q) => q.eq("verdictId", verdict._id)).first();
    const kidText = cleanExplanation(conclusion.summary);

    if (cleared) {
      // Confirmed by the company's own official page: release it and take it off the feed.
      await ctx.db.patch(verdict._id, { level: "real", action: "released", ...(kidText && { explanationForKid: kidText }) });
      if (item && !item.kidAnswer) await ctx.db.delete(item._id);
      await ctx.scheduler.runAfter(0, internal.gmailActions.releaseVerdict, { verdictId: verdict._id });
      return null;
    }
    if (conclusion.level === "fake" && verdict.level !== "fake") {
      await ctx.db.patch(verdict._id, {
        level: "fake",
        action: "held",
        actionAppliedAt: undefined, // the check label was applied; now hold it properly
        ...(kidText && { explanationForKid: kidText }),
      });
      if (item && !item.kidAnswer) await ctx.db.patch(item._id, { kind: "held" });
      await ctx.scheduler.runAfter(0, internal.gmailActions.applyVerdict, { verdictId: verdict._id });
      return null;
    }
    if (kidText) await ctx.db.patch(verdict._id, { explanationForKid: kidText });
    return null;
  },
});

export const familyOfVerdict = internalQuery({
  args: { verdictId: v.id("verdicts") },
  returns: v.union(v.null(), v.object({ familyId: v.id("families"), gmailMessageId: v.string() })),
  handler: async (ctx, { verdictId }) => {
    const verdict = await ctx.db.get(verdictId);
    return verdict ? { familyId: verdict.familyId, gmailMessageId: verdict.gmailMessageId } : null;
  },
});

// ---------- the investigation ----------

const step = (kind: "search" | "visit" | "check" | "finding", text: string) => ({ at: Date.now(), kind, text: plain(text, 160) });

async function emailTextFor(ctx: ActionCtx, verdictId: Id<"verdicts">): Promise<string | undefined> {
  const ref = await ctx.runQuery(internal.investigations.familyOfVerdict, { verdictId });
  if (!ref) return undefined;
  const access = await accessTokenFor(ctx, ref.familyId);
  if (!access.ok) return undefined;
  try {
    const msg = await gmailRequest<{ raw?: string; sizeEstimate?: number }>(access.accessToken, `/messages/${encodeURIComponent(ref.gmailMessageId)}`, {
      params: { format: "raw" },
    });
    if (!msg.raw || (msg.sizeEstimate ?? 0) > 2_000_000) return undefined;
    const b64 = msg.raw.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return (await parseEml(bytes)).text.slice(0, 3000); // in memory only
  } catch {
    return undefined;
  }
}

async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { Accept: "text/html" } });
    return res.ok ? (await res.text()).slice(0, 400_000) : "";
  } catch {
    return "";
  }
}

export const investigate = internalAction({
  args: { verdictId: v.id("verdicts"), facts: factsValidator },
  returns: v.null(),
  handler: async (ctx, { verdictId, facts }) => {
    const opening = [
      step("check", `Checking who really sent this: ${facts.sender.domain || "an unknown address"}.`),
      ...facts.checks.filter((c) => c.status === "fail" || c.status === "warn").slice(0, 4).map((c) => step("finding", c.plainReason)),
    ];
    const investigationId = await ctx.runMutation(internal.investigations.start, { verdictId, steps: opening });
    if (!investigationId) return null; // already done, capped, or turned off
    const add = (steps: ReturnType<typeof step>[]) => ctx.runMutation(internal.investigations.addSteps, { investigationId, steps });

    // 1. Follow every link we can't vouch for to where it really goes.
    const links: Facts["links"] = [];
    let probes = 0;
    for (const l of facts.links) {
      const fact: Facts["links"][number] = { shownText: l.shownText, site: l.site, cls: l.cls, ageDays: l.ageDays, listedDangerous: l.listedDangerous };
      if (l.cls !== "established" && probes < MAX_PROBES) {
        probes++;
        await add([step("visit", `Following the link to ${l.site || "an unknown site"} to see where it really goes.`)]);
        fact.probe = await probeLink(l.href);
        const p = fact.probe;
        const notes = [];
        if (p.finalSite && p.finalSite !== l.site) notes.push(step("finding", `That link actually ends up at ${p.finalSite}.`));
        if (p.asksForPassword) notes.push(step("finding", `The page at ${p.finalSite ?? l.site} asks for a password.`));
        if (l.ageDays !== undefined && l.ageDays < 90) notes.push(step("finding", `${l.site} was set up only ${l.ageDays} days ago.`));
        if (l.listedDangerous) notes.push(step("finding", `Google lists ${l.site} as dangerous.`));
        if (notes.length) await add(notes);
      } else if (l.cls === "established") {
        await add([step("check", `${l.site} is a large, well-known site.`)]);
      }
      links.push(fact);
    }
    const fullFacts: Facts = { ...facts, links };

    // 2. For familiar senders, let the agent read the text (it can then only raise).
    const emailText = facts.familiar ? await emailTextFor(ctx, verdictId) : undefined;
    if (emailText) await add([step("check", "Reading the message to see if it sounds like them.")]);

    // 3. The agent's research.
    const apiKey = process.env.ANTHROPIC_API_KEY;
    let output = null;
    if (apiKey) {
      try {
        const client = new Anthropic({ apiKey, timeout: AGENT_TIMEOUT_MS, maxRetries: 1 });
        const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildBrief(fullFacts, emailText) }];
        let finalText = "";
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const pending: Promise<unknown>[] = [];
          const stream = client.messages.stream({
            model: MODEL,
            max_tokens: 8000,
            output_config: { effort: "medium" },
            system: SYSTEM,
            messages,
            tools: [
              { type: "web_search_20260209", name: "web_search", max_uses: 5 },
              { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 },
            ],
          });
          stream.on("contentBlock", (block) => {
            if (block.type !== "server_tool_use") return;
            const input = block.input as { query?: string; url?: string };
            if (block.name === "web_search" && input.query) pending.push(add([step("search", `Searching the web: ${input.query}`)]));
            if (block.name === "web_fetch" && input.url) {
              const host = cleanUrl(input.url)?.split("/")[2] ?? "a page";
              pending.push(add([step("visit", `Reading ${host}`)]));
            }
          });
          const message = await stream.finalMessage();
          await Promise.all(pending);
          finalText = message.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n");
          if (message.stop_reason !== "pause_turn") break;
          messages.push({ role: "assistant", content: message.content });
        }
        output = parseOutput(finalText);
        if (!output) console.error("investigate: agent output did not parse");
      } catch (e) {
        console.error(`investigate: agent failed (${e instanceof Anthropic.APIError ? e.status : e instanceof Error ? e.name : "error"})`);
      }
    }

    if (!output) {
      const fb = fallbackConclusion(fullFacts);
      await ctx.runMutation(internal.investigations.finish, { investigationId, status: "failed", conclusion: fb, sources: [], cleared: false });
      return null;
    }

    // 4. Safety rules. Clearing needs an official page we confirm ourselves.
    let confirmed = false;
    const official = officialSource(output, facts.claimedOrg);
    if (official && !emailText && output.level === "real" && facts.ruleLevel === "unsure") {
      await add([step("visit", `Double-checking on ${new URL(official).hostname} that this address is really theirs.`)]);
      confirmed = pageConfirmsSender(await fetchPageText(official), facts.sender.domain);
    }
    const decided = decideLevel({
      floor: facts.ruleLevel,
      proposed: output.level,
      readEmailText: emailText !== undefined,
      confirmedByOfficialPage: confirmed,
      senderVerdict: output.sender.verdict,
    });
    await ctx.runMutation(internal.investigations.finish, {
      investigationId,
      status: "done",
      cleared: decided.cleared,
      sources: output.sources.filter((s) => /^https:\/\//.test(s.url)).map((s) => ({ title: plain(s.title, 100), url: s.url.slice(0, 500) })),
      conclusion: {
        level: decided.level,
        summary: plain(output.summary) || fallbackConclusion(fullFacts).summary,
        sender: { verdict: output.sender.verdict, reason: plain(output.sender.reason) },
        links: output.links.slice(0, 10).map((l) => ({ site: plain(l.site, 80), verdict: l.verdict, reason: plain(l.reason) })),
        ...(output.suggestion && plain(output.suggestion) && { suggestion: plain(output.suggestion) }),
      },
    });
    return null;
  },
});

// ---------- queries for the screens ----------

const investigationView = v.union(v.null(), schema.doc("investigations"));

/** The kid's live view of the investigation for one feed item. */
export const forFeedItem = query({
  args: { feedItemId: v.id("feedItems") },
  returns: investigationView,
  handler: async (ctx, { feedItemId }) => {
    const kidUserId = await getAuthUserId(ctx);
    if (kidUserId === null) return null;
    const family = await ctx.db.query("families").withIndex("by_kid", (q) => q.eq("kidUserId", kidUserId)).unique();
    const item = await ctx.db.get(feedItemId);
    if (!family || family.status === "off" || !item || item.familyId !== family._id) return null;
    return await ctx.db.query("investigations").withIndex("by_verdict", (q) => q.eq("verdictId", item.verdictId)).first();
  },
});

/** The same, by the parent's private link. */
export const forFeedItemParent = query({
  args: { parentToken: v.string(), feedItemId: v.id("feedItems") },
  returns: investigationView,
  handler: async (ctx, { parentToken, feedItemId }) => {
    if (parentToken.length === 0 || parentToken.length > 64) return null;
    const family = await ctx.db.query("families").withIndex("by_parent_token", (q) => q.eq("parentToken", parentToken)).unique();
    const item = await ctx.db.get(feedItemId);
    if (!family || family.status === "off" || !item || item.familyId !== family._id) return null;
    return await ctx.db.query("investigations").withIndex("by_verdict", (q) => q.eq("verdictId", item.verdictId)).first();
  },
});
