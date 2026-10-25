// A7: the AI investigator. For each suspicious email, a Claude agent with web search and
// web fetch checks the sender and every link, appending plain-language steps the kid's screen
// shows live, then concludes. Safety rules live in lib/investigator.ts (decideLevel,
// safeConclusion): nothing the model says or cites can lower a level on its own.
//
// Privacy: the email body is never stored or passed through scheduler args. For familiar
// senders the action re-reads the email from Gmail, in memory, so the agent can judge
// "does this sound like them?" (and then it may only raise, and its searches aren't shown).

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
  type AgentOutput,
  buildBrief,
  decideLevel,
  type Facts,
  fallbackConclusion,
  MAX_STEPS,
  MODEL,
  onlyFirstContact,
  parseOutput,
  plain,
  safeConclusion,
  senderIsOfficial,
  SYSTEM,
} from "./lib/investigator";
import { cleanUrl, probeLink } from "./lib/linkProbe";
import { linkIsRisky } from "./lib/sites";

const MAX_PER_HOUR = 20; // per family; beyond this, deterministic checks only
const MAX_PROBES = 5;
const AGENT_BUDGET_MS = 180_000; // the whole agent phase; the action limit is 10 minutes
const MAX_TURNS = 2; // pause_turn resumptions

const factsValidator = v.object({
  ruleLevel: verdictLevel,
  sender: v.object({ name: v.string(), address: v.string(), domain: v.string(), replyTo: v.optional(v.string()) }),
  claimedOrg: v.optional(v.string()),
  officialDomains: v.optional(v.array(v.string())),
  familiar: v.boolean(),
  askedByParent: v.optional(v.boolean()),
  checks: v.array(checkResult),
  links: v.array(
    v.object({
      shownText: v.string(),
      href: v.string(), // already cleaned: scheme + host + path, no query string or tokens
      site: v.string(),
      cls: v.union(v.literal("established"), v.literal("user_content"), v.literal("unknown")),
      ageDays: v.optional(v.number()),
      listedDangerous: v.optional(v.boolean()),
    }),
  ),
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

// ---------- database ----------

async function familyActive(ctx: { db: { get: (id: Id<"families">) => Promise<{ status: string } | null> } }, familyId: Id<"families">) {
  const family = await ctx.db.get(familyId);
  return family !== null && family.status !== "off";
}

export const start = internalMutation({
  args: { verdictId: v.id("verdicts"), steps: v.array(investigationStep) },
  returns: v.union(v.null(), v.id("investigations")),
  handler: async (ctx, { verdictId, steps }) => {
    const verdict = await ctx.db.get(verdictId);
    if (!verdict || !(await familyActive(ctx, verdict.familyId))) return null;
    const existing = await ctx.db.query("investigations").withIndex("by_verdict", (q) => q.eq("verdictId", verdictId)).first();
    if (existing) return null; // one investigation per email
    const recent = await ctx.db
      .query("investigations")
      .withIndex("by_family", (q) => q.eq("familyId", verdict.familyId))
      .order("desc")
      .take(MAX_PER_HOUR + 1);
    if (recent.filter((i) => i.startedAt > Date.now() - 3600_000).length >= MAX_PER_HOUR) return null;
    return await ctx.db.insert("investigations", {
      familyId: verdict.familyId,
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
    if (!inv || inv.status !== "running" || !(await familyActive(ctx, inv.familyId))) return null;
    await ctx.db.patch(investigationId, { steps: [...inv.steps, ...steps].slice(0, MAX_STEPS) });
    return null;
  },
});

/** Record the conclusion and carry it out: raise (hold) or, rarely, clear and release. */
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
    if (!(await familyActive(ctx, inv.familyId))) return null; // turned off: leave nothing behind
    await ctx.db.patch(investigationId, { status, conclusion, sources: sources.slice(0, 8), finishedAt: Date.now() });

    const verdict = await ctx.db.get(inv.verdictId);
    if (!verdict) return null;
    const item = await ctx.db.query("feedItems").withIndex("by_verdict", (q) => q.eq("verdictId", verdict._id)).first();
    const kidText = cleanExplanation(conclusion.summary);
    // The kid already decided: their answer stands. Record the findings, change nothing else.
    if (item?.kidAnswer) return null;

    if (cleared && verdict.askedAt !== undefined) {
      // The parent asked the kid about this one: it stays for the kid to answer, with the finding.
      await ctx.db.patch(verdict._id, { level: "real", ...(kidText && { explanationForKid: kidText }) });
      return null;
    }
    if (cleared) {
      // Our own data confirms the company's real address: release it, take it off the feed.
      await ctx.db.patch(verdict._id, { level: "real", action: "released", ...(kidText && { explanationForKid: kidText }) });
      if (item) await ctx.db.delete(item._id);
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
      if (item && item.kind !== "asked") await ctx.db.patch(item._id, { kind: "held" });
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

/** URLs the agent actually saw in its search and fetch results: the only citable sources. */
function seenUrls(content: Anthropic.ContentBlock[]): Set<string> {
  const urls = new Set<string>();
  for (const block of content as { type: string; content?: unknown; url?: string }[]) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content as { url?: string }[]) if (r.url) urls.add(r.url);
    }
    if (block.type === "web_fetch_tool_result") {
      const c = block.content as { url?: string } | undefined;
      if (c?.url) urls.add(c.url);
    }
  }
  return urls;
}

async function runAgent(
  facts: Facts,
  emailText: string | undefined,
  add: (steps: ReturnType<typeof step>[]) => Promise<unknown>,
): Promise<{ output: AgentOutput | null; seen: Set<string> }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { output: null, seen: new Set() };
  const client = new Anthropic({ apiKey, timeout: AGENT_BUDGET_MS, maxRetries: 1 });
  const deadline = Date.now() + AGENT_BUDGET_MS;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildBrief(facts, emailText) }];
  const seen = new Set<string>();
  let finalText = "";
  for (let turn = 0; turn < MAX_TURNS && Date.now() < deadline; turn++) {
    const pending: Promise<unknown>[] = [];
    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: 8000,
        output_config: { effort: facts.ruleLevel === "fake" ? "low" : "medium" },
        system: SYSTEM,
        messages,
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 5 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4, max_content_tokens: 5000 },
        ],
      },
      { signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) },
    );
    stream.on("contentBlock", (block) => {
      if (block.type !== "server_tool_use") return;
      const input = block.input as { query?: string; url?: string };
      if (block.name === "web_search") {
        // After reading the email, its words could leak into a query: don't show queries then.
        const text = emailText || !input.query ? "Searching the web to check this." : `Searching the web: ${input.query}`;
        pending.push(add([step("search", text)]));
      }
      if (block.name === "web_fetch" && input.url) {
        const host = cleanUrl(input.url)?.split("/")[2] ?? "a page";
        pending.push(add([step("visit", `Reading ${host}`)]));
      }
    });
    const message = await stream.finalMessage();
    await Promise.all(pending);
    for (const url of seenUrls(message.content)) seen.add(url);
    finalText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (message.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: message.content });
  }
  return { output: parseOutput(finalText), seen };
}

export const investigate = internalAction({
  args: { verdictId: v.id("verdicts"), facts: factsValidator },
  returns: v.null(),
  handler: async (ctx, { verdictId, facts }) => {
    const opening = [
      step("check", "Checking who really sent this."),
      ...facts.checks.filter((c) => c.status === "fail" || c.status === "warn").slice(0, 4).map((c) => step("finding", c.plainReason)),
    ];
    const investigationId = await ctx.runMutation(internal.investigations.start, { verdictId, steps: opening });
    if (!investigationId) return null; // already done, capped, or turned off
    // Each line once: two links to one site, or two pages read there, aren't news to the kid.
    const said = new Set(opening.map((s) => s.text));
    const add = async (steps: ReturnType<typeof step>[]) => {
      const fresh = steps.filter((s) => !said.has(s.text) && said.add(s.text));
      if (fresh.length > 0) await ctx.runMutation(internal.investigations.addSteps, { investigationId, steps: fresh });
    };
    const links: Facts["links"] = facts.links.map((l) => ({ ...l, risky: linkIsRisky(l) }));
    const fullFacts: Facts = { ...facts, links };
    let finished = false;

    try {
      // 1. Follow every link we can't vouch for to where it really goes.
      let probes = 0;
      for (const [i, l] of facts.links.entries()) {
        if (l.cls === "established") {
          await add([step("check", `${l.site} is a large, well-known site.`)]);
          continue;
        }
        if (probes >= MAX_PROBES) continue;
        probes++;
        await add([step("visit", `Following the link to ${l.site || "an unknown site"} to see where it really goes.`)]);
        const p = await probeLink(l.href);
        links[i] = { ...links[i], probe: p, risky: linkIsRisky({ ...l, probe: p }) };
        const notes = [];
        if (p.finalSite && p.finalSite !== l.site) notes.push(step("finding", `That link actually ends up at ${p.finalSite}.`));
        if (p.asksForPassword) notes.push(step("finding", `The page at ${p.finalSite ?? l.site} asks for a password.`));
        if (l.ageDays !== undefined && l.ageDays < 90) notes.push(step("finding", `${l.site} was set up only ${l.ageDays} days ago.`));
        if (l.listedDangerous) notes.push(step("finding", `Google lists ${l.site} as dangerous.`));
        if (notes.length) await add(notes);
      }

      // 2. For familiar senders, let the agent read the text (it can then only raise).
      const emailText = facts.familiar ? await emailTextFor(ctx, verdictId) : undefined;
      if (emailText) await add([step("check", "Reading the message to see if it sounds like them.")]);

      // 3. The agent's research.
      let result: { output: AgentOutput | null; seen: Set<string> } = { output: null, seen: new Set() };
      try {
        result = await runAgent(fullFacts, emailText, add);
        if (!result.output && process.env.ANTHROPIC_API_KEY) console.error("investigate: agent output did not parse");
      } catch (e) {
        console.error(`investigate: agent failed (${e instanceof Anthropic.APIError ? e.status : e instanceof Error ? e.name : "error"})`);
      }
      const output = result.output;
      if (!output) {
        await ctx.runMutation(internal.investigations.finish, { investigationId, status: "failed", conclusion: fallbackConclusion(fullFacts), sources: [], cleared: false });
        finished = true;
        return null;
      }

      // 4. Safety rules: our own data decides any clearing; the model's words are kept honest.
      const decided = decideLevel({
        floor: facts.ruleLevel,
        proposed: output.level,
        readEmailText: emailText !== undefined,
        officialAndFirstContact: senderIsOfficial(fullFacts) && onlyFirstContact(fullFacts),
        senderVerdict: output.sender.verdict,
      });
      await ctx.runMutation(internal.investigations.finish, {
        investigationId,
        status: "done",
        cleared: decided.cleared,
        sources: output.sources
          .filter((s) => /^https:\/\//.test(s.url) && result.seen.has(s.url))
          .map((s) => ({ title: plain(s.title, 100), url: s.url.slice(0, 500) })),
        conclusion: safeConclusion(output, fullFacts, decided),
      });
      finished = true;
    } finally {
      if (!finished) {
        // Something threw: never leave the kid watching "investigating..." forever.
        await ctx.runMutation(internal.investigations.finish, { investigationId, status: "failed", conclusion: fallbackConclusion(fullFacts), sources: [], cleared: false });
      }
    }
    return null;
  },
});

// ---------- queries for the screens ----------

const fullView = v.union(
  v.null(),
  v.object({
    _id: v.id("investigations"),
    _creationTime: v.number(),
    familyId: v.id("families"),
    verdictId: v.id("verdicts"),
    status: v.union(v.literal("running"), v.literal("done"), v.literal("failed")),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    steps: v.array(investigationStep),
    conclusion: v.optional(conclusionValidator),
    sources: v.optional(v.array(v.object({ title: v.string(), url: v.string() }))),
  }),
);

/** The kid's live view of the investigation for one feed item. */
export const forFeedItem = query({
  args: { feedItemId: v.id("feedItems") },
  returns: fullView,
  handler: async (ctx, { feedItemId }) => {
    const kidUserId = await getAuthUserId(ctx);
    if (kidUserId === null) return null;
    const family = await ctx.db.query("families").withIndex("by_kid", (q) => q.eq("kidUserId", kidUserId)).unique();
    const item = await ctx.db.get(feedItemId);
    if (!family || family.status === "off" || !item || item.familyId !== family._id) return null;
    return await ctx.db.query("investigations").withIndex("by_verdict", (q) => q.eq("verdictId", item.verdictId)).first();
  },
});

/**
 * The parent's view, by their private link: only our own verdicts, never the model's free
 * text (no email or web page can put words in front of the person we protect).
 */
export const forFeedItemParent = query({
  args: { parentToken: v.string(), feedItemId: v.id("feedItems") },
  returns: v.union(
    v.null(),
    v.object({
      status: v.union(v.literal("running"), v.literal("done"), v.literal("failed")),
      level: v.optional(verdictLevel),
      sender: v.optional(v.union(v.literal("genuine"), v.literal("unverified"), v.literal("impostor"))),
      links: v.array(v.object({ site: v.string(), verdict: v.union(v.literal("safe"), v.literal("unknown"), v.literal("dangerous")) })),
    }),
  ),
  handler: async (ctx, { parentToken, feedItemId }) => {
    if (parentToken.length === 0 || parentToken.length > 64) return null;
    const family = await ctx.db.query("families").withIndex("by_parent_token", (q) => q.eq("parentToken", parentToken)).unique();
    const item = await ctx.db.get(feedItemId);
    if (!family || family.status === "off" || !item || item.familyId !== family._id) return null;
    const inv = await ctx.db.query("investigations").withIndex("by_verdict", (q) => q.eq("verdictId", item.verdictId)).first();
    if (!inv) return null;
    return {
      status: inv.status,
      ...(inv.conclusion && { level: inv.conclusion.level, sender: inv.conclusion.sender.verdict }),
      links: (inv.conclusion?.links ?? []).map((l) => ({ site: l.site, verdict: l.verdict })),
    };
  },
});
