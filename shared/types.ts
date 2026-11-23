// Types shared by server and client. Type-only: never import runtime values from here.

export type QuestionType = 'choice' | 'text';
export type RegionStatus = 'in_progress' | 'green' | 'red';
export type SessionStatus = 'lobby' | 'active' | 'finished';

export interface Region {
  id: string;
  name: string;
}

/** A question as sent to players — never contains the correct answer. */
export interface PublicQuestion {
  id: number;
  regionId: string;
  type: QuestionType;
  prompt: string;
  /** 4 options for 'choice', null for 'text'. */
  options: string[] | null;
  /** 1-based position within the current round. */
  number: number;
  /** 1 = first visit, 2+ = returning to a wrongly explored region. */
  round: number;
  /** Max questions in this round (3 first time, 4 on a retry). */
  total: number;
  /** Correct answers needed to explore the region in this round. */
  toWin: number;
}

export interface QuestionInput {
  regionId: string;
  type: QuestionType;
  prompt: string;
  options?: string[];
  correctIndex?: number;
  acceptedAnswers?: string[];
}

export interface AdminQuestion {
  id: number;
  regionId: string;
  type: QuestionType;
  prompt: string;
  options: string[] | null;
  correctIndex: number | null;
  acceptedAnswers: string[] | null;
  createdAt: number;
  updatedAt: number;
}

export interface PublicPlayer {
  id: number;
  firstName: string;
  lastName: string;
}

export interface SessionInfo {
  roomCode: string;
  status: SessionStatus;
  startedAt: number | null;
  endedAt: number | null;
}

export interface PlayerProgress extends PublicPlayer {
  correctAnswers: number;
  greenRegions: number;
  redRegions: number;
  finishedAt: number | null;
}

export interface ResultRow extends PublicPlayer {
  rank: number;
  correctAnswers: number;
  greenRegions: number;
  redRegions: number;
  timeMs: number;
  finished: boolean;
}

export interface PlayerState {
  player: PublicPlayer;
  session: SessionInfo;
  regions: Record<string, RegionStatus>;
  /** When this player resolved their last region. */
  finishedAt: number | null;
  results: ResultRow[] | null;
  /** Server clock, so clients can correct for a skewed device clock. */
  serverNow: number;
}

export interface AnswerResult {
  correct: boolean;
  /** Human-readable correct answer, shown after answering. */
  correctAnswer: string;
  regionStatus: RegionStatus;
  nextQuestion: PublicQuestion | null;
  playerFinished: boolean;
}

export interface AdminSnapshot {
  session: SessionInfo;
  players: PlayerProgress[];
  totalRegions: number;
  results: ResultRow[] | null;
}

export interface CreatedSession {
  session: SessionInfo;
  joinUrl: string;
  /** PNG data URL of the QR code pointing to joinUrl. */
  qrCode: string;
}

export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: string };
export type Ack<T> = (res: AckResponse<T>) => void;

export interface ClientToServerEvents {
  'player:join': (
    p: { roomCode: string; firstName: string; lastName: string },
    ack: Ack<{ token: string; state: PlayerState }>,
  ) => void;
  'player:resume': (p: { token: string }, ack: Ack<PlayerState>) => void;
  'region:open': (p: { regionId: string }, ack: Ack<PublicQuestion>) => void;
  'region:answer': (
    p: { regionId: string; questionId: number; answer: number | string },
    ack: Ack<AnswerResult>,
  ) => void;
  'admin:watch': (p: { roomCode: string }, ack: Ack<AdminSnapshot>) => void;
  'admin:start': (p: { roomCode: string }, ack: Ack<SessionInfo>) => void;
  'admin:end': (p: { roomCode: string }, ack: Ack<ResultRow[]>) => void;
}

export interface ServerToClientEvents {
  'lobby:players': (players: PublicPlayer[]) => void;
  'game:started': (p: { session: SessionInfo; serverNow: number }) => void;
  'game:ended': (p: { session: SessionInfo; results: ResultRow[] }) => void;
  'admin:progress': (players: PlayerProgress[]) => void;
}

export interface SocketData {
  isAdmin: boolean;
  playerId?: number;
  sessionId?: number;
}
