import { DomainError } from "../domain/model";
import type { UvrQuote } from "../domain/loan-model";
import type { Files } from "./storage";
export const UVR_SOURCE =
  "https://suameca.banrep.gov.co/estadisticas-economicas-back/rest/estadisticaEconomicaRestService/consultaInformacionSerieXTipoDato";
export function parseSuamecaUvr(data: unknown, fetchedAt: string): UvrQuote[] {
  if (!Array.isArray(data)) return [];
  const series = data.find((s: { id?: number }) => s.id === 850);
  if (
    !series ||
    series.unidad !== "Pesos colombianos por UVR" ||
    !Array.isArray(series.data)
  )
    return [];
  return series.data
    .flatMap((entry: unknown) => {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "number" ||
        typeof entry[1] !== "number" ||
        !Number.isFinite(entry[1]) ||
        entry[1] <= 0
      )
        return [];
      const day = new Date(entry[0]);
      if (Number.isNaN(day.valueOf())) return [];
      return [
        {
          date: day.toISOString().slice(0, 10),
          value: String(entry[1]),
          fetchedAt,
          source: UVR_SOURCE,
        },
      ];
    })
    .sort((a: UvrQuote, b: UvrQuote) => a.date.localeCompare(b.date));
}
export async function getUvrQuotes(
  files: Files,
  from: string,
  to: string,
  now: string,
  fetcher: typeof fetch = fetch,
) {
  if (
    from < "2000-01-01" ||
    from > to ||
    Date.parse(to) - Date.parse(from) > 366 * 86400000
  )
    throw new DomainError("Consulta hasta un año de UVR por vez");
  const key = `normalized/public/uvr/${from}_${to}.json`;
  let cached: { quotes: UvrQuote[]; fetchedAt: string } | undefined;
  try {
    cached = JSON.parse(Buffer.from(await files.get(key)).toString());
  } catch {
    /* A first request has no cache. */
  }
  if (
    cached?.quotes.length &&
    Date.parse(now) - Date.parse(cached.fetchedAt) < 12 * 3600000
  )
    return { ...cached, stale: false, source: UVR_SOURCE };
  try {
    const count = Math.max(
      62,
      Math.min(
        12000,
        Math.ceil((Date.parse(now) - Date.parse(from)) / 86400000) + 62,
      ),
    );
    const response = await fetcher(
      `${UVR_SOURCE}?idSerie=850&tipoDato=0&cantDatos=${count}`,
      {
        signal: AbortSignal.timeout(8000),
        headers: {
          Accept: "application/json",
          Origin: "https://suameca.banrep.gov.co",
          Referer: "https://suameca.banrep.gov.co/",
        },
      },
    );
    if (
      !response.ok ||
      Number(response.headers.get("content-length") ?? 0) > 5000000
    )
      throw new Error("UVR unavailable");
    const text = await response.text();
    if (text.length > 5000000) throw new Error("UVR response too large");
    const quotes = parseSuamecaUvr(JSON.parse(text), now).filter(
      (q) => q.date >= from && q.date <= to,
    );
    if (!quotes.length) throw new Error("No valid UVR observations");
    const value = { quotes, fetchedAt: now };
    await files.put(key, Buffer.from(JSON.stringify(value)));
    return { ...value, stale: false, source: UVR_SOURCE };
  } catch {
    if (cached?.quotes.length)
      return {
        ...cached,
        stale: true,
        source: UVR_SOURCE,
        warning:
          "No se pudo actualizar la UVR. Se muestran fechas históricas guardadas.",
      };
    return {
      quotes: [],
      stale: true,
      source: UVR_SOURCE,
      warning:
        "UVR oficial no disponible. Puedes confirmar una cotización y su fecha manualmente; no se reemplaza por una estimación.",
    };
  }
}
