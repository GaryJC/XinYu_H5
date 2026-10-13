const authTokenKey = "repair-h5-auth-token";
const measuredPaths = /^\/api\/(?:ocr\/(?:vehicle-license|license-plate|vin)|files|company-system\/vehicles\/lookup|work-orders\/[^/]+\/ocr-records)$/;

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
  const started = performance.now();
  const measured = options.method === "POST" && measuredPaths.test(path);
  let response: Response | undefined;
  let succeeded = false;
  try {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    const token = options.skipAuth ? "" : getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    response = await fetch(path, {
      method: options.method ?? "GET",
      headers: Object.keys(headers).length ? headers : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw Object.assign(new Error(payload?.error ?? `API request failed: ${response.status}`), { status: response.status });
    }
    succeeded = true;
    return payload as T;
  } finally {
    if (measured) console.info("[ocr-request]", {
      path, durationMs: Math.round(performance.now() - started),
      status: response?.status, succeeded,
      requestId: response?.headers.get("X-Request-Id"),
      serverTiming: response?.headers.get("Server-Timing")
    });
  }
}

export async function requestBlob(path: string): Promise<Blob> {
  const token = getAuthToken();
  const response = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw Object.assign(new Error(payload?.error ?? `API request failed: ${response.status}`), { status: response.status });
  }
  return response.blob();
}
