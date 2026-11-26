import type { AuthUser } from '../modules/auth/auth-user.js';

declare global {
  // Merged into express' Request by @types/express-serve-static-core.
  namespace Express {
    interface Request {
      /** Set by the AccessGuard for authenticated requests. */
      user?: AuthUser;
      /** Session id of the current request (never the token). */
      sessionId?: string;
    }
  }
}

declare module 'http' {
  interface IncomingMessage {
    /** Request id shared by the request-context middleware and pino-http. */
    id?: string | number | object;
  }
}
