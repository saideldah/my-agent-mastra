import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DemoAuth } from '../src/mastra/auth.ts';

test('demo login validates credentials and issues unique, revocable tokens', async () => {
  const auth = new DemoAuth();
  const username = process.env.DEMO_USERNAME ?? 'demo';
  const password = process.env.DEMO_PASSWORD ?? 'demo-password';

  assert.equal(auth.login(username, `${password}-wrong`), null);
  assert.equal(auth.login(`${username}-wrong`, password), null);
  assert.equal(await auth.authenticateToken(''), null);
  assert.equal(await auth.authenticateToken('forged-token'), null);

  const first = auth.login(username, password)!;
  const second = auth.login(username, password)!;
  assert.match(first.accessToken, /^[a-f0-9]{64}$/);
  assert.notEqual(first.accessToken, second.accessToken);
  assert.equal(first.expiresIn, 3600);
  assert.equal(first.tokenType, 'Bearer');
  assert.deepEqual(await auth.authenticateToken(first.accessToken), {
    id: 'demo-user', username,
  });

  auth.revokeToken(first.accessToken);
  assert.equal(await auth.authenticateToken(first.accessToken), null);
  assert.ok(await auth.authenticateToken(second.accessToken));
  assert.equal(await new DemoAuth().authenticateToken(second.accessToken), null);
});

test('tokens expire after one hour and remain invalid afterwards', async context => {
  let now = 1_000_000;
  context.mock.method(Date, 'now', () => now);
  const auth = new DemoAuth();
  const token = auth.login(
    process.env.DEMO_USERNAME ?? 'demo',
    process.env.DEMO_PASSWORD ?? 'demo-password',
  )!;

  now += 3_600_000 - 1;
  assert.ok(await auth.authenticateToken(token.accessToken));
  now += 1;
  assert.equal(await auth.authenticateToken(token.accessToken), null);
  now -= 1;
  assert.equal(await auth.authenticateToken(token.accessToken), null);
});

test('Studio resolves the current user only from a valid, unexpired bearer token', async context => {
  let now = 1_000_000;
  context.mock.method(Date, 'now', () => now);
  const auth = new DemoAuth();
  const username = process.env.DEMO_USERNAME ?? 'demo';
  const credentials = auth.login(username, process.env.DEMO_PASSWORD ?? 'demo-password')!;
  const request = (authorization?: string) => new Request('http://localhost/api/auth/capabilities', {
    headers: authorization ? { Authorization: authorization } : {},
  });

  assert.equal(await auth.getCurrentUser(request()), null);
  assert.equal(await auth.getCurrentUser(request('Bearer forged')), null);
  assert.equal(await auth.getCurrentUser(request(`Basic ${credentials.accessToken}`)), null);
  assert.equal(await auth.getCurrentUser(request(`Bearer ${credentials.accessToken} trailing`)), null);
  assert.deepEqual(await auth.getCurrentUser(request(`Bearer ${credentials.accessToken}`)), {
    id: 'demo-user', username,
  });
  assert.ok(await auth.getCurrentUser(request(`bearer ${credentials.accessToken}`)));

  now += 3_600_000;
  assert.equal(await auth.getCurrentUser(request(`Bearer ${credentials.accessToken}`)), null);
  const next = auth.login(username, process.env.DEMO_PASSWORD ?? 'demo-password')!;
  auth.revokeToken(next.accessToken);
  assert.equal(await auth.getCurrentUser(request(`Bearer ${next.accessToken}`)), null);
});
