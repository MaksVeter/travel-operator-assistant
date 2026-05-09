function required(key: string): string {
	const value = process.env[key];
	if (!value) throw new Error(`Missing required env variable: ${key}`);
	return value;
}

function optional(key: string, fallback: string): string {
	return process.env[key] ?? fallback;
}

export type SabreEnvConfig = {
	soapUrl: string;
	username: string;
	password: string;
	organization: string;
	pseudoCityCode: string;
	domain: string;
	partyFrom: string;
	partyTo: string;
	commandVersion: string;
	logLevel: string;
};

export function loadSabreConfig(): SabreEnvConfig {
	const organization = required("SABRE_ORGANIZATION");
	const pccRaw = process.env.SABRE_PSEUDO_CITY_CODE;
	const pseudoCityCode =
		pccRaw !== undefined && pccRaw !== "" ? pccRaw : organization;
	return {
		soapUrl: required("SABRE_SOAP_URL"),
		username: required("SABRE_USERNAME"),
		password: required("SABRE_PASSWORD"),
		organization,
		pseudoCityCode,
		domain: optional("SABRE_DOMAIN", "DEFAULT"),
		partyFrom: optional("SABRE_PARTY_FROM", "99999"),
		partyTo: optional("SABRE_PARTY_TO", "123123"),
		commandVersion: optional("SABRE_COMMAND_VERSION", "2.0.0"),
		logLevel: optional("LOG_LEVEL", "info"),
	};
}
