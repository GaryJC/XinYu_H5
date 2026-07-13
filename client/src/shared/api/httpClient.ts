const authTokenKey = "repair-h5-auth-token";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  skipAuth?: boolean;
};

export function setAuthToken(token: string) {
  window.localStorage.setItem(authTokenKey, token);
}

export function getAuthToken() {
  return window.localStorage.getItem(authTokenKey) || "";
}

export function clearAuthToken() {
  window.localStorage.removeItem(authTokenKey);
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const token = options.skipAuth ? "" : getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: Object.keys(headers).length ? headers : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? `API request failed: ${response.status}`);
  }
  return payload as T;
}
