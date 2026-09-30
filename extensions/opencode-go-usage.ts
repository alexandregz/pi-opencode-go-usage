/**
 * OpenCode Go Usage Tracker (pi/omp extension)
 *
 * Shows OpenCode Go usage limits — rolling 5-hour, weekly, and monthly — in a
 * live status bar and a `/opencode-go` report widget.
 *
 * Core: the ZEN API exposes usage directly, keyed by a Go API key:
 *
 *     GET https://opencode.ai/zen/go/v1/usage     (Authorization: Bearer <api-key>)
 *     -> { usage: {
 *            rolling: { status, percent, resetsAt },
 *            weekly:  { status, percent, resetsAt },
 *            monthly: { status, percent, resetsAt } } }
 *
 * So this extension calls that endpoint with your Go API key and reads the
 * three percentages (`percent` is already a 0-100 number) plus reset
 * countdowns (`resetsAt` is an ISO rollover timestamp on each window). It
 * reports percentages and countdowns only.
 *
 * UI: mirrors pi-opencode-usage — a status bar after each refresh plus a
 * `/opencode-go` slash command with subcommands for setup and export.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { promises as fs } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type MeterKind = "five_hour" | "calendar_week" | "product_period";

interface UsageMeter {
 kind: MeterKind;
 /** 0-100, clamped. */
 percent: number;
 /** ISO timestamp of rollover, or null when the window reports none. */
 resetsAt: string | null;
}

interface Config {
 apiKey?: string;
 compact?: boolean;
}

type FetchFailure =
 | { kind: "noCredentials" }
 | { kind: "timeout" }
 | { kind: "network"; detail: string }
 | { kind: "unauthorized" }
 | { kind: "http"; status: number }
 | { kind: "noSubscription" }
 | { kind: "noPayload" };

/** ZEN window name -> meter kind. */
const WINDOW_KINDS: { key: string; kind: MeterKind }[] = [
 { key: "rolling", kind: "five_hour" },
 { key: "weekly", kind: "calendar_week" },
 { key: "monthly", kind: "product_period" },
];

const METER_LABEL: Record<MeterKind, string> = {
 five_hour: "Rolling 5h",
 calendar_week: "Weekly",
 product_period: "Monthly",
};

const METER_SHORT: Record<MeterKind, string> = {
 five_hour: "5h",
 calendar_week: "wk",
 product_period: "mo",
};

const DEFAULT_ORIGIN = "https://opencode.ai";
const REFRESH_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Config persistence (0600 file; the API key is a credential)
// ---------------------------------------------------------------------------

/** Resolved per call so tests can redirect it away from the real home. */
function configPath(): string {
 const configuredPath = process.env.OPENCODE_GO_CONFIG_PATH;
 if (configuredPath) return configuredPath;
 const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
 return join(configHome, "opencode-go-usage", "config.json");
}

function reportPath(): string {
 const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
 return join(configHome, "opencode-go-usage", "usage-report.json");
}

async function ensureParentDirectory(path: string): Promise<void> {
 await fs.mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
}

async function loadConfig(): Promise<Config> {
 const path = configPath();
 try {
  return JSON.parse(await fs.readFile(path, "utf8")) as Config;
 } catch {
  return {};
 }
}

async function saveConfig(config: Config): Promise<void> {
 const path = configPath();
 await ensureParentDirectory(path);
 const tmp = `${path}.tmp`;
 await fs.writeFile(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
 await fs.rename(tmp, path);
}

// ---------------------------------------------------------------------------
// Fetch + parse (ZEN API)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
 return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** ZEN sends `percent` as a 0-100 number; clamp to 0-100 and round to 0.1. */
function toPercent(value: unknown): number | null {
 let n: number;
 if (typeof value === "number") n = value;
 else if (typeof value === "string" && value.trim() !== "") n = Number(value);
 else return null;
 if (!Number.isFinite(n)) return null;
 return Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
}

/**
 * Reads `usage.{rolling,weekly,monthly}` out of a `/zen/go/v1/usage` payload.
 * Returns an empty array when the payload carries no usable window — the caller
 * reports that as a changed API rather than as a confident zero.
 */
export function parseUsage(payload: unknown): UsageMeter[] {
 const usage = asRecord(asRecord(payload)?.usage);
 if (!usage) return [];
 const result: UsageMeter[] = [];
 for (const { key, kind } of WINDOW_KINDS) {
  const window = asRecord(usage[key]);
  if (!window) continue;
  const percent = toPercent(window.percent);
  if (percent === null) continue;
  // Each window carries its own reset — no period-end fallback anymore.
  const resetsAtMs = typeof window.resetsAt === "string" ? Date.parse(window.resetsAt) : NaN;
  result.push({
   kind,
   percent,
   resetsAt: Number.isFinite(resetsAtMs) ? new Date(resetsAtMs).toISOString() : null,
  });
 }
 return result;
}

export async function fetchUsage(apiKey: string, origin = DEFAULT_ORIGIN): Promise<UsageMeter[]> {
 if (!apiKey.trim()) {
  throw { kind: "noCredentials" } as FetchFailure;
 }
 const url = `${origin.replace(/\/+$/, "")}/zen/go/v1/usage`;
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
 let response: Response;
 try {
  response = await fetch(url, {
   headers: {
    Authorization: `Bearer ${apiKey.trim()}`,
    Accept: "application/json",
   },
   signal: controller.signal,
  });
 } catch (err) {
  if (err instanceof Error && err.name === "AbortError") {
   throw { kind: "timeout" } as FetchFailure;
  }
  throw {
   kind: "network",
   detail: err instanceof Error ? err.message : String(err),
  } as FetchFailure;
 } finally {
  clearTimeout(timer);
 }
 if (response.status === 401 || response.status === 403) {
  throw { kind: "unauthorized" } as FetchFailure;
 }
 if (!response.ok) throw { kind: "http", status: response.status } as FetchFailure;
 const payload: unknown = await response.json().catch(() => undefined);
 if (payload === undefined || payload === null) {
  throw { kind: "noPayload" } as FetchFailure;
 }
 const meters = parseUsage(payload);
 if (meters.length === 0) throw { kind: "noPayload" } as FetchFailure;
 return meters;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function bar(percent: number, width = 10): string {
 const clamped = Math.min(100, Math.max(0, percent));
 const filled = Math.round((clamped / 100) * width);
 return "█".repeat(filled) + "░".repeat(width - filled);
}

export function countdown(resetsAt: string | null, now = Date.now()): string | null {
 if (!resetsAt) return null;
 const target = Date.parse(resetsAt);
 if (!Number.isFinite(target)) return null;
 const ms = target - now;
 if (ms <= 0) return "resets now";
 const totalMinutes = Math.floor(ms / 60_000);
 const days = Math.floor(totalMinutes / (60 * 24));
 const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
 const minutes = totalMinutes % 60;
 if (days > 0) return `${days}d ${hours}h`;
 if (hours > 0) return `${hours}h ${minutes}m`;
 return `${minutes}m`;
}

function describeFailure(f: FetchFailure): string {
 switch (f.kind) {
  case "noCredentials":
   return "Not connected. Run /opencode-go --connect <api-key>";
  case "timeout":
   return "Request timed out";
  case "network":
   return `Network error: ${f.detail}`;
  case "unauthorized":
   return "Invalid API key — check OPENCODE_GO_API_KEY or the saved key";
  case "http":
   return `HTTP ${f.status}`;
  case "noSubscription":
   return "No Go subscription on this account";
  case "noPayload":
   return "ZEN API response unrecognised — opencode.ai may have changed its API";
 }
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

interface UiCtx {
 hasUI: boolean;
 ui: {
  setStatus(key: string, text: string | undefined): void;
  setWidget(key: string, content: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }): void;
  notify(message: string, type?: "info" | "warning" | "error"): void;
 };
}

export default function opencodeGoUsage(pi: ExtensionAPI): void {
 let config: Config = {};
 let meters: UsageMeter[] = [];
 let lastError: string | null = null;
 let lastFetchedAt = 0;
 let timer: ReturnType<typeof setInterval> | undefined;

 const resolvedKey = (): string | null => {
  const key = (process.env.OPENCODE_GO_API_KEY ?? config.apiKey ?? "").trim();
  return key || null;
 };

 // Env key wins over the saved one, so a --connect/--key/--disconnect can
 // silently do nothing while OPENCODE_GO_API_KEY is set. Surface that instead.
 const envOverrideWarning = (): string | null => {
  const envKey = process.env.OPENCODE_GO_API_KEY?.trim();
  const overrides = envKey !== undefined && envKey !== config.apiKey;
  return overrides
   ? "OPENCODE_GO_API_KEY is set and takes precedence over the saved key — update or unset it"
   : null;
 };

 const fmtUpdate = (ts: number): string => {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  let tz: string;
  try {
   tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local";
  } catch {
   tz = "local";
  }
  return `update ${time} (${tz})`;
 };

 const renderStatus = (ctx: UiCtx): void => {
  if (!ctx.hasUI) return;
  const key = resolvedKey();
  if (!key) {
   ctx.ui.setStatus("opencode-go", "OpenCode Go: not connected (/opencode-go --connect <api-key>)");
   return;
  }
  if (lastError) {
   ctx.ui.setStatus("opencode-go", `OpenCode Go: ${lastError}`);
   return;
  }
  if (meters.length === 0) {
   ctx.ui.setStatus("opencode-go", "OpenCode Go: loading…");
   return;
  }
  const parts = meters.map((m) => {
   if (config.compact) return `${METER_SHORT[m.kind]} ${m.percent}%`;
   const cd = countdown(m.resetsAt);
   return `${METER_SHORT[m.kind]} ${m.percent}%${cd ? ` (${cd})` : ""}`;
  });
  let text = `OpenCode Go: ${parts.join(" · ")}`;
  if (!config.compact && lastFetchedAt) text += ` · ${fmtUpdate(lastFetchedAt)}`;
  ctx.ui.setStatus("opencode-go", text);
 };

 const renderReport = (ctx: UiCtx): void => {
  if (!ctx.hasUI) return;
  const key = resolvedKey();
  const lines: string[] = ["OpenCode Go Usage"];
  if (!key) {
   lines.push("Not connected.");
   lines.push("Run /opencode-go --connect <api-key>");
   lines.push("Or set OPENCODE_GO_API_KEY");
   ctx.ui.setWidget("opencode-go", lines, { placement: "aboveEditor" });
   return;
  }
  if (lastError) {
   lines.push(`Error: ${lastError}`);
  } else if (meters.length === 0) {
   lines.push("Loading…");
  } else {
   for (const m of meters) {
    const cd = countdown(m.resetsAt);
    lines.push(`${METER_LABEL[m.kind].padEnd(10)} ${bar(m.percent, 10)}  ${m.percent}%${cd ? ` · ${cd}` : ""}`);
   }
  }
  if (lastFetchedAt) lines.push(fmtUpdate(lastFetchedAt));
  ctx.ui.setWidget("opencode-go", lines, { placement: "aboveEditor" });
 };

 const refresh = async (ctx: UiCtx): Promise<void> => {
  const key = resolvedKey();
  if (!key) {
   meters = [];
   lastError = null;
   renderStatus(ctx);
   return;
  }
  try {
   meters = await fetchUsage(key, DEFAULT_ORIGIN);
   lastError = null;
   lastFetchedAt = Date.now();
  } catch (err) {
   meters = [];
   lastError = describeFailure(err as FetchFailure);
  }
  renderStatus(ctx);
 };

 pi.on("session_start", async (_event, ctx) => {
  config = await loadConfig();
  if (timer) {
   clearInterval(timer);
   timer = undefined;
  }
  if (ctx.hasUI && resolvedKey()) ctx.ui.notify("OpenCode Go usage tracker loaded", "info");
  // Fire-and-forget: don't block session startup on a network round-trip.
  void refresh(ctx);
  // Plain setInterval with the callback body fully wrapped so a throw cannot
  // escape and tear down the session.
  timer = setInterval(() => {
   void refresh(ctx).catch(() => { });
  }, REFRESH_SECONDS * 1000);
 });

 pi.on("session_shutdown", () => {
  if (timer) {
   clearInterval(timer);
   timer = undefined;
  }
 });

 pi.registerCommand("opencode-go", {
  description:
   "Show OpenCode Go usage. Subcommands: --connect <api-key> | --key <v> | --disconnect | --refresh | --compact [on|off] | --json",
  handler: async (args, ctx) => {
   const tokens = args.trim().split(/\s+/).filter(Boolean);
   const sub = tokens[0];
   const rest = tokens.slice(1);

   if (sub === "--connect" || sub === "--setup") {
    const apiKey = rest.join(" ").trim();
    if (!apiKey) {
     ctx.ui.notify("Usage: /opencode-go --connect <api-key>", "warning");
     return;
    }
    config.apiKey = apiKey;
    await saveConfig(config);
    const envWarning = envOverrideWarning();
    if (envWarning) ctx.ui.notify(envWarning, "warning");
    ctx.ui.notify("Saved. Fetching usage…", "info");
    await refresh(ctx);
    renderReport(ctx);
    return;
   }

   if (sub === "--key" || sub === "--api-key") {
    const apiKey = rest.join(" ").trim();
    if (!apiKey) {
     ctx.ui.notify("Usage: /opencode-go --key <api-key>", "warning");
     return;
    }
    config.apiKey = apiKey;
    await saveConfig(config);
    const envWarning = envOverrideWarning();
    if (envWarning) ctx.ui.notify(envWarning, "warning");
    ctx.ui.notify("API key saved", "info");
    return;
   }

   if (sub === "--disconnect") {
    const envWarning = envOverrideWarning();
    delete config.apiKey;
    await saveConfig(config);
    meters = [];
    lastError = null;
    renderStatus(ctx);
    ctx.ui.setWidget("opencode-go", undefined);
    if (envWarning) ctx.ui.notify(envWarning, "warning");
    ctx.ui.notify("Disconnected", "info");
   }

   if (sub === "--compact") {
    const arg = rest[0];
    config.compact = arg ? arg !== "off" && arg !== "false" : !config.compact;
    await saveConfig(config);
    renderStatus(ctx);
    ctx.ui.notify(`Compact mode ${config.compact ? "on" : "off"}`, "info");
    return;
   }

   if (sub === "--refresh") {
    await refresh(ctx);
    renderReport(ctx);
    return;
   }

   if (sub === "--json") {
    await refresh(ctx);
    const report = {
     apiKeyConfigured: resolvedKey() !== null,
     fetchedAt: lastFetchedAt ? new Date(lastFetchedAt).toISOString() : null,
     error: lastError,
     meters,
    };
    const outPath = reportPath();
    try {
     await ensureParentDirectory(outPath);
     const tmp = `${outPath}.tmp`;
     await fs.writeFile(tmp, JSON.stringify(report, null, 2), "utf8");
     await fs.rename(tmp, outPath);
     ctx.ui.notify(`JSON report written to ${outPath}`, "info");
    } catch {
     ctx.ui.notify("Failed to write JSON report", "error");
    }
    return;
   }

   await refresh(ctx);
   renderReport(ctx);
  },
 });
}