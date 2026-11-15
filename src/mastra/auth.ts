import { randomBytes } from 'node:crypto';
import { MastraAuthProvider, registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';

const TOKEN_LIFETIME_SECONDS = 60 * 60;
const loginSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
});

type DemoUser = { id: string; username: string };
type Session = { user: DemoUser; expiresAt: number };

// Demo sessions live in this server process and are invalidated on restart.
export class DemoAuth extends MastraAuthProvider<DemoUser> {
  private sessions = new Map<string, Session>();

  constructor() {
    super({ name: 'demo-login' });
  }

  login(username: string, password: string) {
    const expectedUsername = process.env.DEMO_USERNAME ?? 'demo';
    const expectedPassword = process.env.DEMO_PASSWORD ?? 'demo-password';
    if (username !== expectedUsername || password !== expectedPassword) {
      return null;
    }

    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(token);
    }

    const accessToken = randomBytes(32).toString('hex');
    this.sessions.set(accessToken, {
      user: { id: 'demo-user', username },
      expiresAt: now + TOKEN_LIFETIME_SECONDS * 1000,
    });
    return { accessToken, tokenType: 'Bearer', expiresIn: TOKEN_LIFETIME_SECONDS };
  }

  async authenticateToken(token: string): Promise<DemoUser | null> {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return session.user;
  }

  // Studio checks this separately from API authentication when loading its UI.
  async getCurrentUser(request: Request): Promise<DemoUser | null> {
    const authorization = request.headers.get('Authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(authorization);
    return match ? this.authenticateToken(match[1]) : null;
  }

  async authorizeUser(user: DemoUser): Promise<boolean> {
    return user.id === 'demo-user';
  }

  revokeToken(token: string) {
    this.sessions.delete(token);
  }
}

export const demoAuth = new DemoAuth();

export const authRoutes = [
  registerApiRoute('/auth/login', {
    method: 'POST',
    requiresAuth: false,
    handler: async c => {
      c.header('Cache-Control', 'no-store');
      const body = await c.req.json().catch(() => null);
      const credentials = loginSchema.safeParse(body);
      if (!credentials.success) {
        return c.json({ error: 'A username and password are required.' }, 400);
      }
      const token = demoAuth.login(credentials.data.username, credentials.data.password);
      if (!token) {
        return c.json({ error: 'Invalid username or password.' }, 401);
      }
      return c.json(token);
    },
  }),
  registerApiRoute('/auth/logout', {
    method: 'POST',
    handler: async c => {
      const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      demoAuth.revokeToken(token);
      return c.body(null, 204);
    },
  }),
];
