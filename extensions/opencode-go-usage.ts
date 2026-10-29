/**
 * OpenCode Go usage extension
 *
 * Adds the `/go-usage` command, which prints a horizontal bar chart of the
 * OpenCode Go allowance (5-hour rolling / weekly / monthly).
 *
 * Data source: GET https://opencode.ai/zen/go/v1/usage
 * The API key is resolved in this order:
 *   1. OPENCODE_GO_API_KEY environment variable
 *   2. `apiKey` in <agent-dir>/opencode-go.json
 *   3. `opencode-go` (or `opencode`) credential in <agent-dir>/auth.json
 *
 * Optional config file <agent-dir>/opencode-go.json:
 *   {
 *     "apiKey": "oc_sk_...",    // explicit key (or "!command" to run a command)
 *     "baseUrl": "https://opencode.ai/zen/go/v1/usage"
 *   }
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const WIDGET_KEY = "opencode-go";
const DEFAULT_URL = "https://opencode.ai/zen/go/v1/usage";
const BAR_WIDTH = 24;

type Meter = { percent: number; limited: boolean; resetsAt?: number };
type Usage = { rolling?: Meter; weekly?: Meter; monthly?: Meter; fetchedAt: number };

type Config = { apiKey?: string; baseUrl: string };

type Theme = { fg: (color: string, text: string) => string };

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function readJson<T>(path: string): T | undefined {
	try {
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return undefined;
	}
}

function loadConfig(): Config {
	const raw = readJson<Partial<Config>>(join(agentDir(), "opencode-go.json")) ?? {};
	return {
		apiKey: typeof raw.apiKey === "string" && raw.apiKey.length > 0 ? raw.apiKey : undefined,
		baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl.startsWith("http") ? raw.baseUrl : DEFAULT_URL,
	};
}

function fromCommand(value: string): string | undefined {
	const command = value.slice(1).trim();
	if (!command) return undefined;
	try {
		const out = execFileSync("/bin/sh", ["-c", command], { encoding: "utf8", timeout: 15_000 }).trim();
		return out || undefined;
	} catch {
		return undefined;
	}
}

function resolveKey(explicit?: string): string | undefined {
	const env = process.env.OPENCODE_GO_API_KEY?.trim();
	if (env) return env;

	if (explicit) return explicit.startsWith("!") ? fromCommand(explicit) : explicit;

	const auth = readJson<Record<string, unknown>>(join(agentDir(), "auth.json"));
	for (const id of ["opencode-go", "opencode"]) {
		const entry = auth?.[id];
		if (!entry) continue;
		if (typeof entry === "string" && entry.trim()) return entry.trim();
		if (typeof entry === "object") {
			const record = entry as Record<string, unknown>;
			for (const field of ["key", "access", "apiKey", "token"]) {
				const value = record[field];
				if (typeof value === "string" && value.trim()) {
					return value.startsWith("!") ? fromCommand(value) : value.trim();
				}
			}
		}
	}
	return undefined;
}

function toMeter(value: unknown): Meter | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	const percent = typeof record.percent === "number" ? record.percent : Number(record.percent);
	if (!Number.isFinite(percent)) return undefined;
	const rawResets = record.resetsAt;
	const resetsAt =
		typeof rawResets === "number"
			? rawResets
			: typeof rawResets === "string" && rawResets.length > 0
				? Date.parse(rawResets) || undefined
				: undefined;
	return {
		percent: Math.max(0, Math.min(100, percent)),
		limited: record.status === "rate-limited" || record.limited === true,
		resetsAt: resetsAt && resetsAt > 0 ? resetsAt : undefined,
	};
}

async function fetchUsage(config: Config): Promise<Usage> {
	const key = resolveKey(config.apiKey);
	if (!key) throw new Error("No OpenCode Go API key found (checked auth.json and OPENCODE_GO_API_KEY)");

	const response = await fetch(config.baseUrl, {
		headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) {
		throw new Error(
			response.status === 401 || response.status === 403
				? `OpenCode Go credentials rejected (HTTP ${response.status})`
				: `OpenCode Go usage request failed (HTTP ${response.status})`,
		);
	}

	const payload = (await response.json()) as { usage?: Record<string, unknown> };
	const usage = payload?.usage;
	if (!usage || typeof usage !== "object") throw new Error("Unexpected OpenCode Go usage response");

	const parsed: Usage = {
		rolling: toMeter(usage.rolling),
		weekly: toMeter(usage.weekly),
		monthly: toMeter(usage.monthly),
		fetchedAt: Date.now(),
	};
	if (!parsed.rolling && !parsed.weekly && !parsed.monthly) {
		throw new Error("OpenCode Go usage response contained no allowance data");
	}
	return parsed;
}

function percent(value: number): number {
	return Math.round(value);
}

function formatRemaining(ms: number): string {
	if (ms <= 0) return "now";
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 60) return `${Math.max(1, minutes)}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ${minutes % 60}m`;
	const days = Math.floor(hours / 24);
	return `${days}d ${hours % 24}h`;
}

function meterColor(meter: Meter | undefined): "success" | "warning" | "error" | "dim" {
	if (!meter) return "dim";
	if (meter.limited || meter.percent >= 90) return "error";
	if (meter.percent >= 60) return "warning";
	return "success";
}

function bar(meter: Meter, theme: Theme | undefined): string {
	if (!meter) return "";
	const filled = Math.round((meter.percent / 100) * BAR_WIDTH);
	const filledText = "█".repeat(filled);
	const emptyText = "░".repeat(BAR_WIDTH - filled);
	return theme
		? theme.fg(meterColor(meter), filledText) + theme.fg("dim", emptyText)
		: filledText + emptyText;
}

function resetText(meter: Meter): string {
	const limit = meter.limited ? "limited · " : "";
	if (!meter.resetsAt) return limit ? "limited" : "";
	return `${limit}resets in ${formatRemaining(meter.resetsAt - Date.now())}`;
}

function chartLines(usage: Usage, theme?: Theme): string[] {
	const rows: Array<[string, Meter | undefined]> = [
		["5 hour", usage.rolling],
		["Weekly", usage.weekly],
		["Monthly", usage.monthly],
	];
	const title = theme ? theme.fg("accent", "OpenCode Go usage") : "OpenCode Go usage";
	const lines = [title];
	for (const [label, meter] of rows) {
		if (!meter) {
			lines.push("", `  ${label.padEnd(8)} ${"".padEnd(BAR_WIDTH, "·")}    n/a`);
			continue;
		}
		const percentText = `${String(percent(meter.percent)).padStart(3)}%`;
		const tail = resetText(meter);
		lines.push("", `  ${label.padEnd(8)} ${bar(meter, theme)} ${percentText}  ${tail}`.trimEnd());
	}
	lines.push("");
	return lines;
}

export default function (pi: ExtensionAPI) {
	const config = loadConfig();
	let widgetCtx: { ui: { setWidget: (key: string, content: unknown) => void } } | undefined;
	let unsubscribeInput: (() => void) | undefined;

	function hideUsageWidget(): void {
		const ctx = widgetCtx;
		widgetCtx = undefined;
		unsubscribeInput?.();
		unsubscribeInput = undefined;
		if (!ctx) return;
		try {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
		} catch {
			// Context became stale (session replacement/reload).
		}
	}

	function showUsageWidget(
		ctx: { ui: { setWidget: (key: string, content: unknown) => void; onTerminalInput: (handler: (data: string) => { consume?: boolean } | undefined) => () => void } },
		lines: string[],
	): void {
		widgetCtx = ctx;
		// A component factory (instead of a string array) keeps blank spacer lines.
		ctx.ui.setWidget(WIDGET_KEY, () => ({
			invalidate() {},
			render(width: number) {
				return lines.map((line) => truncateToWidth(line, width));
			},
		}));
		unsubscribeInput?.();
		unsubscribeInput = ctx.ui.onTerminalInput((data) => {
			if (!widgetCtx) return undefined;
			if (matchesKey(data, "escape")) {
				hideUsageWidget();
				return { consume: true };
			}
			return undefined;
		});
	}

	pi.on("session_shutdown", async () => {
		hideUsageWidget();
	});

	pi.registerCommand("go-usage", {
		description:
			"Show OpenCode Go limit usage as a horizontal bar chart (5-hour, weekly, monthly). Press Esc to close.",
		handler: async (_args, ctx) => {
			let usage: Usage;
			try {
				usage = await fetchUsage(config);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) ctx.ui.notify(message, "error");
				else console.error(message);
				return;
			}

			if (ctx.mode !== "tui") {
				if (!ctx.hasUI) console.log(chartLines(usage).join("\n"));
				else ctx.ui.setWidget(WIDGET_KEY, chartLines(usage));
				return;
			}

			const theme = ctx.ui.theme;
			const lines = chartLines(usage, theme);
			showUsageWidget(ctx, lines);
		},
	});
}
