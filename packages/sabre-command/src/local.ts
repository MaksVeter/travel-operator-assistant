import { loadSabreConfig } from "./config.ts";
import { log } from "./log.ts";
import { runSabreHostCommand, validateSabreHostCommand } from "./sabre-soap.ts";

/**
 * Run from repo root (loads root .env):
 *   bun run sabre-command:local
 *   bun run sabre-command:local "*A"
 * Validate + IgnoreTransaction (dry-run): pass -- before flags if using npm/bun script:
 *   bun run sabre-command:local -- --validate "*A"
 * JSON includes validTechnical, validSemantic, semanticReason (when semantic fails).
 */
const raw = process.argv.slice(2);
const validateOnly = raw.includes("--validate");
const args = raw.filter((a) => a !== "--validate");
const command = args[0] ?? "*A";

const cfg = loadSabreConfig();
log.info("SABRE_SOAP_URL", cfg.soapUrl);
log.info(validateOnly ? "Validate (dry-run)" : "Host command", command);

try {
	if (validateOnly) {
		const v = await validateSabreHostCommand(cfg, command);
		console.log(
			JSON.stringify(
				{
					command,
					validTechnical: v.validTechnical,
					validSemantic: v.validSemantic,
					technicalReason: v.technicalReason,
					semanticReason: v.semanticReason,
					...(v.screen !== undefined ? { screen: v.screen } : {}),
					...(v.error ? { error: v.error } : {}),
				},
				null,
				2,
			),
		);
		if (!v.validTechnical || !v.validSemantic) process.exitCode = 1;
	} else {
		const result = await runSabreHostCommand(cfg, command);
		console.log(
			JSON.stringify(
				{
					command,
					screen: result.screen ?? null,
					rawXmlChars: result.rawXml.length,
				},
				null,
				2,
			),
		);
		if (process.env.SABRE_LOCAL_RAW === "1") {
			console.log("--- raw XML ---\n", result.rawXml);
		}
	}
} catch (err) {
	log.error(err);
	process.exitCode = 1;
}
