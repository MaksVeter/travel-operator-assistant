type Level = "debug" | "info" | "warn" | "error";

function levelRank(l: Level): number {
	switch (l) {
		case "debug":
			return 10;
		case "info":
			return 20;
		case "warn":
			return 30;
		case "error":
			return 40;
	}
}

const minLevel: Level =
	(process.env.LOG_LEVEL ?? "info") === "debug"
		? "debug"
		: (process.env.LOG_LEVEL ?? "info") === "warn"
			? "warn"
			: (process.env.LOG_LEVEL ?? "info") === "error"
				? "error"
				: "info";

function logAt(level: Level, ...args: unknown[]) {
	if (levelRank(level) < levelRank(minLevel)) return;
	const prefix = `[sabre-command] ${level}:`;
	if (level === "error") {
		console.error(prefix, ...args);
	} else {
		console.log(prefix, ...args);
	}
}

export const log = {
	debug: (...a: unknown[]) => logAt("debug", ...a),
	info: (...a: unknown[]) => logAt("info", ...a),
	warn: (...a: unknown[]) => logAt("warn", ...a),
	error: (...a: unknown[]) => logAt("error", ...a),
};
