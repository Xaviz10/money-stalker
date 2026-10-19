import { accessToken, apiURL, local } from "./auth";
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await accessToken();
  if (!local && !token) {
    window.dispatchEvent(new Event("session-expired"));
    throw new Error("Tu sesión terminó. Inicia sesión de nuevo.");
  }
  const result = await fetch(apiURL + path, {
    ...options,
    cache: "no-store",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!result.ok) {
    if (result.status === 401)
      window.dispatchEvent(new Event("session-expired"));
    const error = await result.json().catch(() => ({}));
    throw new Error(
      error.error ?? `No se pudo completar la solicitud (${result.status})`,
    );
  }
  return result.json();
}
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export async function download(format: "csv" | "xlsx", accountId?: string) {
  const token = await accessToken();
  if (!local && !token) throw new Error("Inicia sesión para exportar");
  const scope = accountId ? `&accountId=${encodeURIComponent(accountId)}` : "";
  const response = await fetch(`${apiURL}/exports?format=${format}${scope}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (!response.ok) throw new Error("No se pudo exportar");
  const url = URL.createObjectURL(await response.blob()),
    link = document.createElement("a");
  link.href = url;
  link.download = `money-stalker.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
