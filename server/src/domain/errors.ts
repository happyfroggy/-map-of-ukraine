/** An expected, user-facing error (message is shown to the user as-is). */
export class GameError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'GameError';
    this.status = status;
  }
}
