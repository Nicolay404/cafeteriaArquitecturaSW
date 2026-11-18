import { readWebConfig } from '../../../../server/config.ts';
import { proxyAuth } from '../../../../server/auth-proxy.ts';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ ruta: string[] }>;
}

async function handle(request: Request, context: Context) {
  const { ruta } = await context.params;
  return proxyAuth(request, ruta, readWebConfig().apiBaseUrl);
}

export const GET = handle;
export const POST = handle;
