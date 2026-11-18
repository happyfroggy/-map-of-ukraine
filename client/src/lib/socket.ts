import { io, type Socket } from 'socket.io-client';
import type { Ack, AckResponse, ClientToServerEvents, ServerToClientEvents } from '../../../shared/types.ts';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createSocket(auth: Record<string, string> = {}): GameSocket {
  return io({ auth, autoConnect: false, transports: ['websocket', 'polling'] });
}

type Event = keyof ClientToServerEvents;
type Payload<E extends Event> = Parameters<ClientToServerEvents[E]>[0];
type Result<E extends Event> = Parameters<ClientToServerEvents[E]>[1] extends Ack<infer T> ? T : never;

/** Emits an event and resolves with the server's ack data (rejects with its error message). */
export function request<E extends Event>(socket: GameSocket, event: E, payload: Payload<E>): Promise<Result<E>> {
  return new Promise((resolve, reject) => {
    const emit = socket.timeout(10_000).emit as unknown as (
      e: E,
      p: Payload<E>,
      cb: (err: Error | null, res: AckResponse<Result<E>>) => void,
    ) => void;
    emit(event, payload, (err, res) => {
      if (err) reject(new Error('Сервер не відповідає. Перевірте з’єднання.'));
      else if (res.ok) resolve(res.data);
      else reject(new Error(res.error));
    });
  });
}
