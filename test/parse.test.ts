import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bar, countdown, fetchUsage, parseUsage } from "../extensions/opencode-go-usage";
import opencodeGoUsage from "../extensions/opencode-go-usage";

// Shape of GET https://opencode.ai/zen/go/v1/usage: each window carries its own
// `percent` (already a 0-100 number) and `resetsAt`.
const FIXTURE = {
  usage: {
    rolling: { status: "ok", percent: 0, resetsAt: "2026-09-20T17:01:34.979Z" },
    weekly: { status: "ok", percent: 48, resetsAt: "2026-09-21T00:00:00.979Z" },
    monthly: { status: "ok", percent: 72, resetsAt: "2026-10-04T14:50:18.979Z" },
  },
};

test("parseUsage maps the three ZEN windows", () => {
  const meters = parseUsage(FIXTURE);
  expect(meters.map((m) => m.kind)).toEqual(["five_hour", "calendar_week", "product_period"]);
  expect(meters.map((m) => m.percent)).toEqual([0, 48, 72]);
  const [rolling, weekly, monthly] = meters;
  expect(rolling.resetsAt).toBe("2026-09-20T17:01:34.979Z");
  // Each window keeps its own reset — no period-end fallback anymore.
  expect(weekly.resetsAt).toBe("2026-09-21T00:00:00.979Z");
  expect(monthly.resetsAt).toBe("2026-10-04T14:50:18.979Z");
});

test("parseUsage leaves the reset null when a window reports no resetsAt", () => {
  const meters = parseUsage({ usage: { monthly: { percent: 72 } } });
  expect(meters).toEqual([{ kind: "product_period", percent: 72, resetsAt: null }]);
});

test("parseUsage skips windows without a usable percent and tolerates status", () => {
  const meters = parseUsage({
    usage: {
      // `status` is tolerated but never gates: "error" still counts.
      rolling: { status: "error", percent: 33 },
      // Missing percent drops the window.
      weekly: { status: "ok" },
      // An unparsable percent drops the window too.
      monthly: { percent: "not-a-number" },
    },
  });
  expect(meters).toEqual([{ kind: "five_hour", percent: 33, resetsAt: null }]);
});

test("parseUsage always lands on a finite, clamped, rounded percent", () => {
  const meters = parseUsage({
    usage: { rolling: { percent: 12.34 }, weekly: { percent: 250 }, monthly: { percent: -5 } },
  });
  expect(meters.map((m) => m.percent)).toEqual([12.3, 100, 0]);
  expect(meters.every((m) => Number.isFinite(m.percent))).toBe(true);
});

test("parseUsage reports nothing for payloads without usable windows", () => {
  expect(parseUsage(null)).toEqual([]);
  expect(parseUsage({})).toEqual([]);
  expect(parseUsage({ usage: {} })).toEqual([]);
  expect(parseUsage({ usage: { rolling: { status: "error" } } })).toEqual([]);
});

test("fetchUsage asks the ZEN API with a Bearer key and parses the answer", async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify(FIXTURE), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  try {
    const meters = await fetchUsage("sk-opencode-0123456789abcdef");
    expect(calls[0].url).toBe("https://opencode.ai/zen/go/v1/usage");
    expect(calls[0].headers.Authorization).toBe("Bearer sk-opencode-0123456789abcdef");
    // The legacy console-auth headers are gone entirely.
    expect(calls[0].headers.Cookie).toBeUndefined();
    expect(calls[0].headers["x-org-id"]).toBeUndefined();
    expect(calls[0].headers["User-Agent"]).toBeUndefined();
    expect(meters.map((m) => m.percent)).toEqual([0, 48, 72]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("fetchUsage rejects a missing key and surfaces API failures", async () => {
  await expect(fetchUsage("   ")).rejects.toMatchObject({ kind: "noCredentials" });
  const realFetch = globalThis.fetch;
  const respond = (body: string | null, status = 200) => {
    globalThis.fetch = (async () =>
      new Response(body, { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  };
  try {
    respond(JSON.stringify({ _tag: "Unauthorized" }), 401);
    await expect(fetchUsage("sk-stale")).rejects.toMatchObject({ kind: "unauthorized" });
    respond(JSON.stringify({ _tag: "Forbidden" }), 403);
    await expect(fetchUsage("sk-stale")).rejects.toMatchObject({ kind: "unauthorized" });
    respond(JSON.stringify({ _tag: "Broken" }), 500);
    await expect(fetchUsage("sk-stale")).rejects.toMatchObject({ kind: "http", status: 500 });
    respond("null");
    await expect(fetchUsage("sk-fresh")).rejects.toMatchObject({ kind: "noPayload" });
    respond(JSON.stringify({ message: "no subscription" }));
    await expect(fetchUsage("sk-fresh")).rejects.toMatchObject({ kind: "noPayload" });
    respond(JSON.stringify({ usage: {} }));
    await expect(fetchUsage("sk-fresh")).rejects.toMatchObject({ kind: "noPayload" });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("countdown formats", () => {
  const now = Date.parse("2026-08-16T00:00:00Z");
  expect(countdown(new Date(now + 1_200_000).toISOString(), now)).toBe("20m");
  expect(countdown(new Date(now + 4_320_000).toISOString(), now)).toBe("1h 12m");
  expect(countdown(new Date(now + 273_600_000).toISOString(), now)).toBe("3d 4h");
  expect(countdown(null, now)).toBeNull();
});

test("bar", () => {
  expect(bar(62, 10)).toBe("██████░░░░");
  expect(bar(0, 10)).toBe("░░░░░░░░░░");
  expect(bar(100, 10)).toBe("██████████");
  expect(bar(150, 10)).toBe("██████████");
});

function mockPi() {
  const handlers: Record<string, Array<(...a: unknown[]) => unknown>> = {};
  const state: { command?: { name: string; options: Record<string, unknown> } } = {};
  const pi = {
    on(event: string, fn: (...a: unknown[]) => unknown) {
      (handlers[event] ??= []).push(fn);
    },
    registerCommand(name: string, options: Record<string, unknown>) {
      state.command = { name, options };
    },
  };
  return { pi, handlers, state };
}

test("factory registers lifecycle handlers and the slash command", () => {
  const { pi, handlers, state } = mockPi();
  opencodeGoUsage(pi as never);
  expect(handlers["session_start"]?.length).toBe(1);
  expect(handlers["session_shutdown"]?.length).toBe(1);
  expect(state.command?.name).toBe("opencode-go");
});

test("command handler renders 'not connected' without a key", async () => {
  delete process.env.OPENCODE_GO_API_KEY;
  const { pi, state } = mockPi();
  opencodeGoUsage(pi as never);
  const widgets: string[][] = [];
  const statuses: Array<[string, string | undefined]> = [];
  const ctx = {
    hasUI: true,
    ui: {
      setStatus: (k: string, t: string | undefined) => statuses.push([k, t]),
      setWidget: (_k: string, c: string[] | undefined) => { if (c) widgets.push(c); },
      notify: () => { },
    },
  };
  await (state.command!.options.handler as (a: string, c: unknown) => Promise<void>)("", ctx);
  expect(widgets[0][0]).toBe("OpenCode Go Usage");
  expect(widgets[0].join("\n")).toContain("Not connected");
  expect(widgets[0].join("\n")).toContain("/opencode-go --connect <api-key>");
  expect(widgets[0].join("\n")).toContain("OPENCODE_GO_API_KEY");
  expect(statuses[0][1]).toContain("not connected");
});

test("saving a key warns while the env var shadows it", async () => {
  const { pi, state } = mockPi();
  opencodeGoUsage(pi as never);
  const notices: Array<[string, string | undefined]> = [];
  const ctx = {
    hasUI: true,
    ui: { setStatus: () => { }, setWidget: () => { }, notify: (m: string, t?: string) => notices.push([m, t]) },
  };
  const run = (args: string) =>
    (state.command!.options.handler as (a: string, c: unknown) => Promise<void>)(args, ctx);

  // Never let a test touch the user's real config file.
  const dir = await mkdtemp(join(tmpdir(), "opencode-go-usage-test-"));
  const configFile = join(dir, "opencode-go-usage.json");
  process.env.OPENCODE_GO_CONFIG_PATH = configFile;
  process.env.OPENCODE_GO_API_KEY = "sk_env";
  try {
    await run("--key fresh-key");
    // The save landed in the scratch file…
    expect(JSON.parse(await readFile(configFile, "utf8")).apiKey).toBe("fresh-key");
    // …but the env value wins at read time, so the user is told.
    expect(notices.some(([m, t]) => t === "warning" && m.includes("OPENCODE_GO_API_KEY"))).toBe(true);

    notices.length = 0;
    process.env.OPENCODE_GO_API_KEY = "fresh-key";
    await run("--key fresh-key");
    expect(notices.some(([, t]) => t === "warning")).toBe(false);
  } finally {
    delete process.env.OPENCODE_GO_CONFIG_PATH;
    delete process.env.OPENCODE_GO_API_KEY;
  }
});