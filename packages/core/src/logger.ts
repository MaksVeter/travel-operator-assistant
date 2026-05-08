const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

function currentLevel(): Level {
	const env = (process.env.LOG_LEVEL ?? "info").toLowerCase();
	return env in LEVELS ? (env as Level) : "info";
}

function shouldLog(level: Level): boolean {
	return LEVELS[level] >= LEVELS[currentLevel()];
}

export const log = {
	debug(...args: unknown[]) {
		if (shouldLog("debug")) console.debug("[DEBUG]", ...args);
	},
	info(...args: unknown[]) {
		if (shouldLog("info")) console.info("[INFO]", ...args);
	},
	warn(...args: unknown[]) {
		if (shouldLog("warn")) console.warn("[WARN]", ...args);
	},
	error(...args: unknown[]) {
		console.error("[ERROR]", ...args);
	},
};
