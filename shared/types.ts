// Types shared by server and client. Type-only: never import runtime values from here.

export type QuestionType = 'choice' | 'text';
export type RegionStatus = 'in_progress' | 'green' | 'red';
export type SessionStatus = 'lobby' | 'active' | 'finished';

export interface Region {
  id: string;
  name: string;
}

/** A question as sent to players — never contains the correct answer. Each question is one drone. */
export interface PublicQuestion {
  id: number;
  regionId: string;
  type: QuestionType;
  prompt: string;
  /** 4 options for 'choice' (shuffled per player), null for 'text'. */
  options: string[] | null;
  /** Drones still over the region, including the one this question belongs to. */
  dronesLeft: number;
  dronesTotal: number;
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
  /** Drones shot down = correct answers. */
  correctAnswers: number;
  /** Regions cleared of all drones (green). */
  greenRegions: number;
  mistakes: number;
  finishedAt: number | null;
}

export interface ResultRow extends PublicPlayer {
  rank: number;
  correctAnswers: number;
  greenRegions: number;
  mistakes: number;
  timeMs: number;
  finished: boolean;
}

export interface PlayerState {
  player: PublicPlayer;
  session: SessionInfo;
  /** Drones left per region the player has opened; unopened regions have dronesPerRegion. */
  drones: Record<string, number>;
  dronesPerRegion: number;
  mistakes: number;
  /** When this player cleared their last region. */
  finishedAt: number | null;
  results: ResultRow[] | null;
  /** Server clock, so clients can correct for a skewed device clock. */
  serverNow: number;
}

export interface AnswerResult {
  /** Correct = the drone is shot down. */
  correct: boolean;
  /** Human-readable correct answer, shown after answering. */
  correctAnswer: string;
  dronesLeft: number;
  /** All drones of the region are down — it turns green. */
  regionCleared: boolean;
  /** The next drone's question (a different one after a mistake), or null when cleared. */
  nextQuestion: PublicQuestion | null;
  playerFinished: boolean;
}

export interface AdminSnapshot {
  session: SessionInfo;
  players: PlayerProgress[];
  totalRegions: number;
  dronesPerRegion: number;
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
