export type SessionTurn = {
	query: string;
	command: string;
	intent: string | null;
	timestamp: number;
};

export type Session = {
	id: string;
	turns: SessionTurn[];
	createdAt: number;
	lastAccessedAt: number;
};

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TURNS = 10;

const sessions = new Map<string, Session>();

export function getOrCreateSession(sessionId: string): Session {
	let session = sessions.get(sessionId);
	if (!session) {
		session = {
			id: sessionId,
			turns: [],
			createdAt: Date.now(),
			lastAccessedAt: Date.now(),
		};
		sessions.set(sessionId, session);
	}
	session.lastAccessedAt = Date.now();
	return session;
}

export function addTurnToSession(
	sessionId: string,
	turn: SessionTurn,
): void {
	const session = getOrCreateSession(sessionId);
	session.turns.push(turn);
	if (session.turns.length > MAX_TURNS) {
		session.turns = session.turns.slice(-MAX_TURNS);
	}
}

export function getSessionHistory(sessionId: string): SessionTurn[] {
	const session = sessions.get(sessionId);
	if (!session) return [];
	return session.turns;
}

export function cleanExpiredSessions(): number {
	const now = Date.now();
	let cleaned = 0;
	for (const [id, session] of sessions) {
		if (now - session.lastAccessedAt > SESSION_TTL_MS) {
			sessions.delete(id);
			cleaned++;
		}
	}
	return cleaned;
}

// Run cleanup every 5 minutes
setInterval(cleanExpiredSessions, 5 * 60 * 1000);
