/**
 * Internet lookups. Tries NHTSA straight from the browser first; if that's blocked (CORS,
 * an ad blocker, a captive portal), retries through the Mac helper's /nhtsa/ relay.
 */
import { parseRecalls, parseVinDecode, recallsUrl, RECALLS_BASE, vinDecodeUrl, VPIC_BASE, type DecodedVin, type Recall } from '../../../core/nhtsa.ts';

/** http://localhost:35001 from ws://localhost:35001/elm */
export function helperBase(bridgeUrl: string): string {
  try {
    const u = new URL(bridgeUrl);
    return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`;
  } catch {
    return 'http://localhost:35001';
  }
}

async function getJson(direct: string, viaHelper: string): Promise<unknown> {
  const attempt = async (url: string) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`NHTSA answered ${res.status}`);
    return res.json();
  };
  try {
    return await attempt(direct);
  } catch (first) {
    try {
      return await attempt(viaHelper);
    } catch {
      throw new Error(`Couldn’t reach NHTSA (${(first as Error).message}). Is the laptop online? The iPhone tether needs to be first in the network order.`);
    }
  }
}

export async function decodeVinOnline(vin: string, bridgeUrl: string): Promise<DecodedVin | null> {
  const helper = `${helperBase(bridgeUrl)}/nhtsa/vpic`;
  return parseVinDecode(await getJson(vinDecodeUrl(vin, VPIC_BASE), vinDecodeUrl(vin, helper)));
}

export async function recallsOnline(make: string, model: string, year: number, bridgeUrl: string): Promise<Recall[]> {
  const helper = `${helperBase(bridgeUrl)}/nhtsa/recalls`;
  return parseRecalls(await getJson(recallsUrl(make, model, year, RECALLS_BASE), recallsUrl(make, model, year, helper)));
}
