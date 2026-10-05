import { ApiError, notFound } from './errors';
import { json, type Ctx, type Handler, type Reply } from './http';
import { activity } from './routes/activity';
import { login, signup } from './routes/auth';
import { me } from './routes/me';
import { createPayment } from './routes/payments';
import { cancelRequest, createRequest, declineRequest, listRequests, payRequest } from './routes/requests';
import { createSettlement } from './routes/settlements';
import { createSplit } from './routes/splits';
import { exportSnapshot, importSnapshot, reset } from './routes/testControl';

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

const route = (method: string, path: string, handler: Handler): Route => ({
  method,
  pattern: new RegExp(`^${path.replace(/:id/g, '([^/]+)')}/?$`),
  handler,
});

const routes: Route[] = [
  route('GET', '/health', () => json(200, { status: 'ok' })),
  route('POST', '/_test/reset', reset),
  route('GET', '/_test/export', exportSnapshot),
  route('POST', '/_test/import', importSnapshot),
  route('POST', '/auth/signup', signup),
  route('POST', '/auth/login', login),
  route('GET', '/me', me),
  route('POST', '/payments', createPayment),
  route('POST', '/requests', createRequest),
  route('GET', '/requests', listRequests),
  route('POST', '/requests/:id/pay', payRequest),
  route('POST', '/requests/:id/decline', declineRequest),
  route('POST', '/requests/:id/cancel', cancelRequest),
  route('POST', '/splits', createSplit),
  route('GET', '/activity', activity),
  route('POST', '/settlements', createSettlement),
];

export function dispatch(ctx: Ctx): Reply {
  try {
    let pathMatched = false;
    for (const { method, pattern, handler } of routes) {
      const match = pattern.exec(ctx.path);
      if (!match) continue;
      pathMatched = true;
      if (method === ctx.method) return handler(ctx, match.slice(1));
    }
    if (pathMatched) throw new ApiError(405, 'method_not_allowed', `${ctx.method} is not supported here`);
    throw notFound(`no route ${ctx.path}`);
  } catch (error) {
    return errorReply(error);
  }
}

export function errorReply(error: unknown): Reply {
  if (error instanceof ApiError) {
    return json(error.status, { error: { code: error.code, message: error.message } });
  }
  console.error(error);
  return json(500, { error: { code: 'internal_error', message: 'unexpected server error' } });
}
