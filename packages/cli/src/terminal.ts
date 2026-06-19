const ANSI = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	cyan: "\x1b[36m",
	brightCyan: "\x1b[96m",
	green: "\x1b[32m",
	brightGreen: "\x1b[92m",
	yellow: "\x1b[33m",
	brightYellow: "\x1b[93m",
	magenta: "\x1b[35m",
	blue: "\x1b[34m",
	brightBlue: "\x1b[94m",
	gray: "\x1b[90m",
	white: "\x1b[37m",
	brightWhite: "\x1b[97m",
} as const;

export type ColorKey = keyof typeof ANSI;

export function useColors(stream: NodeJS.WriteStream = process.stderr): boolean {
	return process.env.NO_COLOR !== "1" && stream.isTTY === true;
}

function paint(enabled: boolean, color: ColorKey, text: string): string {
	if (!enabled) return text;
	return `${ANSI[color]}${text}${ANSI.reset}`;
}

export function createTerminal(stream: NodeJS.WriteStream = process.stderr) {
	const on = useColors(stream);

	const c = (color: ColorKey, text: string) => paint(on, color, text);

	const write = (line = "") => {
		stream.write(`${line}\n`);
	};

	const writeRaw = (text: string) => {
		stream.write(text);
	};

	const loading = {
		async run<T>(label: string, fn: () => Promise<T>): Promise<T> {
			if (!on) {
				write(`  ${label}...`);
				return fn();
			}

			const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
			let frame = 0;
			const interval = setInterval(() => {
				writeRaw(
					`\r  ${c("gray", frames[frame++ % frames.length])} ${c("gray", label)}...`,
				);
			}, 80);

			try {
				return await fn();
			} finally {
				clearInterval(interval);
				writeRaw("\r\x1b[K");
			}
		},
	};

	const pause = (ms: number) =>
		new Promise<void>((resolve) => setTimeout(resolve, ms));

	const divider = (char = "─", width = 56) => {
		write(c("gray", char.repeat(width)));
	};

	const step = {
		blank() {
			write();
		},
		divider,
		header(n: number, title: string) {
			write();
			write(
				`  ${c("brightYellow", `${n}.`)} ${c("bold", c("brightCyan", title))}`,
			);
		},
		label(key: string, value: string) {
			write(`    ${c("gray", `${key}:`)} ${value}`);
		},
		indented(text: string, indent = 4) {
			write(`${" ".repeat(indent)}${text}`);
		},
		dim(text: string, indent = 4) {
			write(`${" ".repeat(indent)}${c("gray", text)}`);
		},
		highlight(text: string, indent = 4) {
			write(`${" ".repeat(indent)}${c("brightWhite", text)}`);
		},
		command(text: string) {
			write(`    ${c("gray", "command:")} ${c("bold", c("brightGreen", text))}`);
		},
		sabreLine(text: string) {
			write(`    ${c("brightBlue", text)}`);
		},
		error(text: string) {
			write(`    ${c("magenta", text)}`);
		},
	};

	const welcome = (opts: {
		version: string;
		debug: boolean;
		sabre: boolean;
		session: boolean;
	}) => {
		const { version, debug, sabre, session } = opts;
		write();
		write(c("brightCyan", "╭──────────────────────────────────────────────────────╮"));
		const title = "Travel Operator Assistant";
		const inner = 50;
		const gap = Math.max(1, inner - title.length - version.length);
		write(
			`${c("brightCyan", "│")}  ${c("bold", c("brightWhite", title))}${" ".repeat(gap)}${c("gray", version)}  ${c("brightCyan", "│")}`,
		);
		write(
			`${c("brightCyan", "│")}  ${c("gray", "Natural language  →  Sabre GDS command")}                 ${c("brightCyan", "│")}`,
		);
		write(c("brightCyan", "╰──────────────────────────────────────────────────────╯"));
		write();
		write(`  ${c("bold", c("brightWhite", "Pipeline"))}${debug ? c("gray", " (debug on)") : ""}`);
		write(`    ${c("brightYellow", "1.")} Input query         ${c("gray", "— your request in plain English")}`);
		write(`    ${c("brightYellow", "2.")} Context search      ${c("gray", "— hybrid retrieval + intent")}`);
		write(`    ${c("brightYellow", "3.")} Command generation  ${c("gray", "— LLM + validation")}`);
		if (sabre) {
			write(`    ${c("brightYellow", "4.")} Sabre result        ${c("gray", "— dry-run in Sabre cert")}`);
		}
		write();
		write(`  ${c("bold", c("brightWhite", "Commands"))}`);
		write(`    ${c("brightGreen", "/help")}      ${c("gray", "show this help")}`);
		write(`    ${c("brightGreen", "/clear")}     ${c("gray", "clear session history")}`);
		write(`    ${c("brightGreen", "/history")}   ${c("gray", "show session history")}`);
		write(`    ${c("brightGreen", "exit")}       ${c("gray", "quit")}`);
		write();
		if (session) {
			write(`  ${c("gray", "Session:")} ${c("gray", "enabled (last 10 turns)")}`);
		}
		write();
		divider();
		write();
	};

	const finalResult = (command: string) => {
		write();
		divider();
		write(`  ${c("bold", c("brightGreen", command))}`);
		divider();
	};

	const prompt = () =>
		on
			? `${c("bold", c("brightCyan", "travel"))}${c("gray", ">")} `
			: "travel> ";

	const bye = () => {
		write();
		write(`  ${c("gray", "Bye!")}`);
		write();
	};

	return { c, write, step, welcome, finalResult, prompt, bye, loading, pause, on };
}
