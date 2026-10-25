// Runs every .eml in ./fixtures (and ./fixtures/private) through all the checks.
// Each fixture says what it expects in its own headers; see fixtures/README.md.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkId, checkStatus, verdictLevel, type CheckId, type CheckStatus, type VerdictLevel } from "../contract";
import { runChecks } from "./index";
import { parseEml } from "./parse";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

const LEVELS = verdictLevel.members.map((m) => m.value);
const IDS = checkId.members.map((m) => m.value);
const STATUSES = checkStatus.members.map((m) => m.value);

function listEml(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listEml(path);
    return entry.name.toLowerCase().endsWith(".eml") ? [path] : [];
  });
}

function headerBlock(raw: string): string {
  const end = raw.search(/\r?\n\r?\n/);
  return end === -1 ? raw : raw.slice(0, end);
}

function readExpectations(raw: string) {
  const head = headerBlock(raw);
  const level = /^X-Anchor-Expected-Level:\s*(\S+)/im.exec(head)?.[1]?.toLowerCase();
  const checks: Partial<Record<CheckId, CheckStatus>> = {};
  const list = /^X-Anchor-Expected-Checks:\s*(.+)$/im.exec(head)?.[1] ?? "";
  for (const pair of list.split(";").map((s) => s.trim()).filter(Boolean)) {
    const [id, status] = pair.split("=").map((s) => s.trim().toLowerCase());
    if (!IDS.includes(id as CheckId) || !STATUSES.includes(status as CheckStatus)) {
      throw new Error(`Bad X-Anchor-Expected-Checks entry "${pair}"`);
    }
    checks[id as CheckId] = status as CheckStatus;
  }
  return { level, checks };
}

const files = listEml(FIXTURES);

describe("email fixtures", () => {
  it("has the five demo emails", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files) {
    const name = file.slice(FIXTURES.length + 1);
    it(name, async () => {
      const raw = readFileSync(file, "utf8");
      const expected = readExpectations(raw);
      expect(LEVELS, `${name}: add "X-Anchor-Expected-Level: real|unsure|fake" at the top`).toContain(expected.level as VerdictLevel);

      const result = runChecks(await parseEml(raw));
      const statuses = Object.fromEntries(result.checks.map((c) => [c.id, c.status]));
      const summary = result.checks.map((c) => `${c.id}=${c.status} (${c.detail ?? ""})`).join("\n");

      expect(result.ruleLevel, `${name}\n${summary}`).toBe(expected.level);
      for (const [id, status] of Object.entries(expected.checks)) {
        expect(statuses[id], `${name}: ${id}\n${summary}`).toBe(status);
      }
    });
  }
});
