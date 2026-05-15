import type { SabreEnvConfig } from "./config.ts";
import {
	describeHostScreenSemanticRejection,
	describeHostScreenTechnicalRejection,
} from "./host-screen-semantic.ts";

const SOAP_ACTION_OTA = '"OTA"';
const SOAP_ACTION_IGNORE = '"IgnoreTransactionLLSRQ"';

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function isoUtc(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Sabre LL SRQ often expects `YYYY-MM-DDTHH:mm:ss` without `Z` (see SOAP UI samples). */
function sabreLocalTimestamp(): string {
	return new Date().toISOString().slice(0, 19);
}


export function extractBinarySecurityToken(xml: string): string | null {
	const m = xml.match(
		/<(?:[\w-]+:)?BinarySecurityToken(?:\s[^>]*)?>([^<]+)<\/(?:[\w-]+:)?BinarySecurityToken>/,
	);
	return m?.[1]?.trim() ?? null;
}

export function extractFaultString(xml: string): string | null {
	const m = xml.match(/<(?:[\w-]+:)?faultstring(?:\s[^>]*)?>([^<]*)<\/(?:[\w-]+:)?faultstring>/i);
	return m?.[1]?.trim() ?? null;
}

/** Host LLS payloads often include stl:ApplicationResults — treat Error as rejection. */
export function interpretSabreLlsResult(xml: string): { ok: boolean; detail?: string } {
	const fault = extractFaultString(xml);
	if (fault) return { ok: false, detail: fault };

	const m = xml.match(
		/<(?:[\w-]+:)?ApplicationResults\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?ApplicationResults>/i,
	);
	if (!m?.[1]) return { ok: true };

	const inner = m[1];
	if (/<(?:[\w-]+:)?Error\b/i.test(inner)) {
		const shortText = inner.match(/ShortText="([^"]+)"/)?.[1];
		const message = inner.match(/<(?:[\w-]+:)?(?:Message|Text)\b[^>]*>([^<]+)</i)?.[1];
		return {
			ok: false,
			detail: shortText ?? message?.trim() ?? "ApplicationResults error",
		};
	}
	return { ok: true };
}

async function postSoap(
	soapUrl: string,
	envelope: string,
	soapAction: string = SOAP_ACTION_OTA,
): Promise<string> {
	const res = await fetch(soapUrl, {
		method: "POST",
		headers: {
			"Content-Type": "text/xml; charset=utf-8",
			SOAPAction: soapAction,
		},
		body: envelope,
	});
	const text = await res.text();
	if (!res.ok) {
		const fault = extractFaultString(text);
		const detail =
			text.match(/<(?:[\w-]+:)?Message[^>]*>([^<]{1,400})</i)?.[1]?.trim() ??
			text.match(/ShortText="([^"]+)"/)?.[1];
		throw new Error(
			[fault, detail].filter(Boolean).join(" — ") ||
				`Sabre HTTP ${res.status}: ${text.slice(0, 1200)}`,
		);
	}
	return text;
}

function sessionCreateEnvelope(cfg: SabreEnvConfig, conversationId: string): string {
	const u = escapeXml(cfg.username);
	const p = escapeXml(cfg.password);
	const org = escapeXml(cfg.organization);
	const domain = escapeXml(cfg.domain);
	const pcc = escapeXml(cfg.pseudoCityCode);
	const ts = isoUtc();
	return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:eb="http://www.ebxml.org/namespaces/messageHeader" xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext">
  <SOAP-ENV:Header>
    <eb:MessageHeader SOAP-ENV:mustUnderstand="1" eb:version="1.0">
      <eb:From><eb:PartyId eb:type="urn:x12.org:IO5:01">${escapeXml(cfg.partyFrom)}</eb:PartyId></eb:From>
      <eb:To><eb:PartyId eb:type="urn:x12.org:IO5:01">${escapeXml(cfg.partyTo)}</eb:PartyId></eb:To>
      <eb:CPAId>${org}</eb:CPAId>
      <eb:ConversationId>${escapeXml(conversationId)}</eb:ConversationId>
      <eb:Service eb:type="SessionToken">SessionCreateRQ</eb:Service>
      <eb:Action>SessionCreateRQ</eb:Action>
      <eb:MessageData>
        <eb:MessageId>mid:${conversationId}@client</eb:MessageId>
        <eb:Timestamp>${ts}</eb:Timestamp>
      </eb:MessageData>
    </eb:MessageHeader>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${u}</wsse:Username>
        <wsse:Password>${p}</wsse:Password>
        <Organization>${org}</Organization>
        <Domain>${domain}</Domain>
      </wsse:UsernameToken>
    </wsse:Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <SessionCreateRQ returnContextID="true" xmlns="http://www.opentravel.org/OTA/2002/11">
      <POS>
        <Source PseudoCityCode="${pcc}"/>
      </POS>
    </SessionCreateRQ>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

function sabreCommandEnvelope(
	cfg: SabreEnvConfig,
	conversationId: string,
	binaryToken: string,
	hostCommand: string,
): string {
	const u = escapeXml(cfg.username);
	const p = escapeXml(cfg.password);
	const org = escapeXml(cfg.organization);
	const domain = escapeXml(cfg.domain);
	const hdrTs = isoUtc();
	const bodyTs = sabreLocalTimestamp();
	const ver = escapeXml(cfg.commandVersion);
	const cmd = escapeXml(hostCommand);
	return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:eb="http://www.ebxml.org/namespaces/messageHeader" xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext">
  <SOAP-ENV:Header>
    <eb:MessageHeader SOAP-ENV:mustUnderstand="1" eb:version="1.0">
      <eb:From><eb:PartyId eb:type="urn:x12.org:IO5:01">${escapeXml(cfg.partyFrom)}</eb:PartyId></eb:From>
      <eb:To><eb:PartyId eb:type="urn:x12.org:IO5:01">${escapeXml(cfg.partyTo)}</eb:PartyId></eb:To>
      <eb:CPAId>${org}</eb:CPAId>
      <eb:ConversationId>${escapeXml(conversationId)}</eb:ConversationId>
      <eb:Service eb:type="Sabre">SabreCommandLLSRQ</eb:Service>
      <eb:Action>SabreCommandLLSRQ</eb:Action>
      <eb:MessageData>
        <eb:MessageId>mid:${conversationId}@client</eb:MessageId>
        <eb:Timestamp>${hdrTs}</eb:Timestamp>
      </eb:MessageData>
    </eb:MessageHeader>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${u}</wsse:Username>
        <wsse:Password>${p}</wsse:Password>
        <Organization>${org}</Organization>
        <Domain>${domain}</Domain>
      </wsse:UsernameToken>
      <wsse:BinarySecurityToken>${binaryToken}</wsse:BinarySecurityToken>
    </wsse:Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <SabreCommandLLSRQ ReturnHostCommand="true" TimeStamp="${bodyTs}" Version="${ver}" xmlns="http://webservices.sabre.com/sabreXML/2011/10">
      <Request Output="SCREEN">
        <HostCommand>${cmd}</HostCommand>
      </Request>
    </SabreCommandLLSRQ>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

function ignoreTransactionEnvelope(
	cfg: SabreEnvConfig,
	conversationId: string,
	binaryToken: string,
): string {
	const u = escapeXml(cfg.username);
	const p = escapeXml(cfg.password);
	const org = escapeXml(cfg.organization);
	const domain = escapeXml(cfg.domain);
	const hdrTs = isoUtc();
	const bodyTs = sabreLocalTimestamp();
	return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:eb="http://www.ebxml.org/namespaces/messageHeader" xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext">
  <SOAP-ENV:Header>
    <eb:MessageHeader SOAP-ENV:mustUnderstand="1" eb:version="1.0">
      <eb:From><eb:PartyId eb:type="urn:x12.org:IO5:01">${escapeXml(cfg.partyFrom)}</eb:PartyId></eb:From>
      <eb:To><eb:PartyId eb:type="urn:x12.org:IO5:01">${escapeXml(cfg.partyTo)}</eb:PartyId></eb:To>
      <eb:CPAId>${org}</eb:CPAId>
      <eb:ConversationId>${escapeXml(conversationId)}</eb:ConversationId>
      <eb:Service eb:type="Sabre">IgnoreTransactionLLSRQ</eb:Service>
      <eb:Action>IgnoreTransactionLLSRQ</eb:Action>
      <eb:MessageData>
        <eb:MessageId>mid:${conversationId}-ignore@client</eb:MessageId>
        <eb:Timestamp>${hdrTs}</eb:Timestamp>
      </eb:MessageData>
    </eb:MessageHeader>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${u}</wsse:Username>
        <wsse:Password>${p}</wsse:Password>
        <Organization>${org}</Organization>
        <Domain>${domain}</Domain>
      </wsse:UsernameToken>
      <wsse:BinarySecurityToken>${binaryToken}</wsse:BinarySecurityToken>
    </wsse:Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <IgnoreTransactionRQ ReturnHostCommand="false" TimeStamp="${bodyTs}" Version="2.0.0" xmlns="http://webservices.sabre.com/sabreXML/2011/10"/>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

function sessionCloseEnvelope(
	cfg: SabreEnvConfig,
	conversationId: string,
	binaryToken: string,
): string {
	const u = escapeXml(cfg.username);
	const p = escapeXml(cfg.password);
	const org = escapeXml(cfg.organization);
	const domain = escapeXml(cfg.domain);
	const ts = isoUtc();
	return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:eb="http://www.ebxml.org/namespaces/messageHeader" xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext">
  <SOAP-ENV:Header>
    <eb:MessageHeader SOAP-ENV:mustUnderstand="1" eb:version="1.0">
      <eb:From><eb:PartyId eb:type="urn:x12.org:IO5:01">${escapeXml(cfg.partyFrom)}</eb:PartyId></eb:From>
      <eb:To><eb:PartyId eb:type="urn:x12.org:IO5:01">${escapeXml(cfg.partyTo)}</eb:PartyId></eb:To>
      <eb:CPAId>${org}</eb:CPAId>
      <eb:ConversationId>${escapeXml(conversationId)}</eb:ConversationId>
      <eb:Service eb:type="OTA">SessionCloseRQ</eb:Service>
      <eb:Action>SessionCloseRQ</eb:Action>
      <eb:MessageData>
        <eb:MessageId>mid:${conversationId}-close@client</eb:MessageId>
        <eb:Timestamp>${ts}</eb:Timestamp>
      </eb:MessageData>
    </eb:MessageHeader>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${u}</wsse:Username>
        <wsse:Password>${p}</wsse:Password>
        <Organization>${org}</Organization>
        <Domain>${domain}</Domain>
      </wsse:UsernameToken>
      <wsse:BinarySecurityToken>${binaryToken}</wsse:BinarySecurityToken>
    </wsse:Security>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <SessionCloseRQ Version="1.0.0" xmlns="http://www.opentravel.org/OTA/2002/11"/>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

export type SabreCommandResult = {
	rawXml: string;
	screen?: string;
	/** True when IgnoreTransactionRQ ran after the host command (dry-run / validate). */
	discardedTransaction?: boolean;
};

export type RunHostCommandOptions = {
	/**
	 * Call IgnoreTransactionLLSRQ after the command so the host drops uncommitted edits (terminal «I»),
	 * when the command would have changed the working copy. Use for validation / dry-run.
	 */
	discardTransaction?: boolean;
};

export type ValidateCommandResult = {
	/** SOAP / ApplicationResults + no host **technical** screen (INVALID_*, FORMAT/INVLD, ERR, bare FORMAT). */
	validTechnical: boolean;
	/** Technical OK and no **semantic** screen (lookup, context, …); host busy lines are ignored. */
	validSemantic: boolean;
	/** Host screen matched a technical rule (only when `validTechnical` is false and `error` is null). */
	technicalReason: string | null;
	/** Host screen matched a semantic rule (only when `validTechnical` and not `validSemantic`). */
	semanticReason: string | null;
	/** Transport / SOAP / IgnoreTransaction failure. */
	error: string | null;
	/** Host screen from SabreCommandLLSRQ (present when SOAP path succeeded). */
	screen?: string;
};

function extractSabreCommandResponse(xml: string): string | undefined {
	const m = xml.match(
		/<(?:[\w-]+:)?Response[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Response>/,
	);
	if (!m?.[1]) return undefined;
	const inner = m[1];
	const text = inner
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/<[^>]+>/g, "")
		.trim();
	return text || undefined;
}

export async function runSabreHostCommand(
	cfg: SabreEnvConfig,
	hostCommand: string,
	options: RunHostCommandOptions = {},
): Promise<SabreCommandResult> {
	const { discardTransaction = false } = options;
	const conversationId = crypto.randomUUID();
	const createXml = await postSoap(cfg.soapUrl, sessionCreateEnvelope(cfg, conversationId));
	const faultCreate = extractFaultString(createXml);
	if (faultCreate) {
		throw new Error(`SessionCreate fault: ${faultCreate}`);
	}
	const token = extractBinarySecurityToken(createXml);
	if (!token) {
		throw new Error("SessionCreate: no BinarySecurityToken in response");
	}
	try {
		const cmdXml = await postSoap(
			cfg.soapUrl,
			sabreCommandEnvelope(cfg, conversationId, token, hostCommand),
		);
		const faultCmd = extractFaultString(cmdXml);
		if (faultCmd) {
			throw new Error(`SabreCommandLLSRQ fault: ${faultCmd}`);
		}
		const interp = interpretSabreLlsResult(cmdXml);
		if (!interp.ok) {
			throw new Error(interp.detail ?? "Sabre host rejected the command");
		}

		let discardedTransaction = false;
		if (discardTransaction) {
			const ignXml = await postSoap(
				cfg.soapUrl,
				ignoreTransactionEnvelope(cfg, conversationId, token),
				SOAP_ACTION_IGNORE,
			);
			const ignInterp = interpretSabreLlsResult(ignXml);
			if (!ignInterp.ok) {
				throw new Error(
					`IgnoreTransactionLLSRQ failed: ${ignInterp.detail ?? "unknown"}`,
				);
			}
			discardedTransaction = true;
		}

		return {
			rawXml: cmdXml,
			screen: extractSabreCommandResponse(cmdXml),
			discardedTransaction,
		};
	} finally {
		try {
			await postSoap(cfg.soapUrl, sessionCloseEnvelope(cfg, conversationId, token));
		} catch {
			// best-effort close
		}
	}
}

/** Validate-only: run host command, then IgnoreTransactionLLSRQ (no EndTransaction). */
export async function validateSabreHostCommand(
	cfg: SabreEnvConfig,
	hostCommand: string,
): Promise<ValidateCommandResult> {
	try {
		const result = await runSabreHostCommand(cfg, hostCommand, {
			discardTransaction: true,
		});
		const screen = result.screen;
		const technicalReason = describeHostScreenTechnicalRejection(screen);
		if (technicalReason !== null) {
			return {
				validTechnical: false,
				validSemantic: false,
				technicalReason,
				semanticReason: null,
				error: null,
				screen,
			};
		}
		const semanticReason = describeHostScreenSemanticRejection(screen);
		const sem = semanticReason;
		return {
			validTechnical: true,
			validSemantic: sem === null,
			technicalReason: null,
			semanticReason: sem ?? null,
			error: null,
			screen,
		};
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		return {
			validTechnical: false,
			validSemantic: false,
			technicalReason: null,
			semanticReason: null,
			error,
			screen: undefined,
		};
	}
}
