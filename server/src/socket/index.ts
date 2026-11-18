import type { Server, Socket } from 'socket.io';
import { ZodError } from 'zod';
import type { Ack, ClientToServerEvents, ServerToClientEvents, SocketData } from '../../../shared/types.ts';
import { GameError } from '../domain/errors.ts';
import type { GameService, PlayerRow } from '../domain/game.ts';
import type { Auth } from '../http/auth.ts';
import { answerSchema, formatZodError, joinSchema, openRegionSchema, resumeSchema, roomSchema } from '../validation.ts';

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Players of a session. */
const playerRoom = (sessionId: number) => `session:${sessionId}`;
/** Admin screens watching a session. */
const adminRoom = (sessionId: number) => `admin:${sessionId}`;

/** Runs a handler and turns its return value / thrown error into an ack response. */
function respond<T>(ack: Ack<T> | undefined, fn: () => T): void {
  if (typeof ack !== 'function') return;
  try {
    ack({ ok: true, data: fn() });
  } catch (err) {
    if (err instanceof GameError) ack({ ok: false, error: err.message });
    else if (err instanceof ZodError) ack({ ok: false, error: formatZodError(err) });
    else {
      console.error(err);
      ack({ ok: false, error: 'Внутрішня помилка сервера' });
    }
  }
}

export function attachSocketHandlers(io: IO, game: GameService, auth: Auth): void {
  io.use((socket, next) => {
    socket.data.isAdmin = auth.verifyToken(socket.handshake.auth?.adminToken);
    next();
  });

  const everyone = (sessionId: number) => io.to([playerRoom(sessionId), adminRoom(sessionId)]);

  const broadcastLobby = (sessionId: number) => everyone(sessionId).emit('lobby:players', game.listPlayers(sessionId));
  const broadcastProgress = (sessionId: number) => io.to(adminRoom(sessionId)).emit('admin:progress', game.progress(sessionId));
  const finishGame = (sessionId: number) => {
    const results = game.endSession(sessionId);
    everyone(sessionId).emit('game:ended', { session: game.sessionInfo(game.getSessionById(sessionId)), results });
    return results;
  };

  io.on('connection', (socket: GameSocket) => {
    const attachPlayer = (player: PlayerRow) => {
      const prev = socket.data.sessionId;
      if (prev !== undefined && prev !== player.session_id) void socket.leave(playerRoom(prev));
      socket.data.playerId = player.id;
      socket.data.sessionId = player.session_id;
      void socket.join(playerRoom(player.session_id));
    };
    const requirePlayer = () => {
      const { playerId, sessionId } = socket.data;
      if (playerId === undefined || sessionId === undefined) throw new GameError('Спершу приєднайтеся до гри', 401);
      return { playerId, sessionId };
    };
    const requireAdmin = () => {
      if (!socket.data.isAdmin) throw new GameError('Потрібна авторизація адміністратора', 401);
    };

    // ----- player -----

    socket.on('player:join', (payload, ack) =>
      respond(ack, () => {
        const input = joinSchema.parse(payload);
        const player = game.joinPlayer(input.roomCode, input.firstName, input.lastName);
        attachPlayer(player);
        broadcastLobby(player.session_id);
        broadcastProgress(player.session_id);
        return { token: player.token, state: game.playerState(player.id) };
      }),
    );

    socket.on('player:resume', (payload, ack) =>
      respond(ack, () => {
        const player = game.getPlayerByToken(resumeSchema.parse(payload).token);
        attachPlayer(player);
        const state = game.playerState(player.id);
        if (state.session.status === 'lobby') socket.emit('lobby:players', game.listPlayers(player.session_id));
        return state;
      }),
    );

    socket.on('region:open', (payload, ack) =>
      respond(ack, () => {
        const { playerId } = requirePlayer();
        return game.openRegion(playerId, openRegionSchema.parse(payload).regionId);
      }),
    );

    socket.on('region:answer', (payload, ack) =>
      respond(ack, () => {
        const { playerId, sessionId } = requirePlayer();
        const input = answerSchema.parse(payload);
        const result = game.answer(playerId, input.regionId, input.questionId, input.answer);
        broadcastProgress(sessionId);
        if (result.playerFinished && game.allPlayersFinished(sessionId)) {
          // Let the ack for the final answer go out before the game:ended broadcast.
          queueMicrotask(() => {
            try {
              finishGame(sessionId);
            } catch (err) {
              console.error(err);
            }
          });
        }
        return result;
      }),
    );

    // ----- admin -----

    socket.on('admin:watch', (payload, ack) =>
      respond(ack, () => {
        requireAdmin();
        const session = game.getSessionByCode(roomSchema.parse(payload).roomCode);
        void socket.join(adminRoom(session.id));
        return game.adminSnapshot(session.id);
      }),
    );

    socket.on('admin:start', (payload, ack) =>
      respond(ack, () => {
        requireAdmin();
        const session = game.getSessionByCode(roomSchema.parse(payload).roomCode);
        const info = game.startSession(session.id);
        everyone(session.id).emit('game:started', { session: info, serverNow: Date.now() });
        return info;
      }),
    );

    socket.on('admin:end', (payload, ack) =>
      respond(ack, () => {
        requireAdmin();
        const session = game.getSessionByCode(roomSchema.parse(payload).roomCode);
        return finishGame(session.id);
      }),
    );
  });
}
