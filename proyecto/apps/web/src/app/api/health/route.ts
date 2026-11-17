import { readWebConfig } from '../../../server/config.ts';
import { proxyHealth } from '../../../server/health-proxy.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return await proxyHealth(readWebConfig().apiBaseUrl);
  } catch {
    return Response.json(
      { status: 'unavailable', version: 'unknown' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
