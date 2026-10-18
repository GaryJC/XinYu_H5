const authTokenKey = "repair-h5-auth-token";
const measuredPaths = /^\/api\/(?:ocr\/(?:vehicle-license|license-plate|vin)|files|company-system\/vehicles\/lookup|work-orders\/[^/]+\/ocr-records)$/;
const imageCache = new Map<string, { blob: Blob; expiresAt: number }>();
const pendingImages = new Map<string, Promise<Blob>>();
const imageCacheLimit = 16 * 1024 * 1024;
let imageCacheBytes = 0;
let imageCacheToken = "";
let imageCacheGeneration = 0;

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  skipAuth?: boolean;
};

export function setAuthToken(token: string) {
  clearImageCache();
  window.localStorage.setItem(authTokenKey, token);
  window.dispatchEvent(new Event("repair-h5-auth-token-changed"));
}

export function getAuthToken() {
  return window.localStorage.getItem(authTokenKey) || "";
}

export function clearAuthToken() {
  clearImageCache();
  window.localStorage.removeItem(authTokenKey);
  window.dispatchEvent(new Event("repair-h5-auth-token-changed"));
}

function clearImageCache() {
  imageCache.clear();
  pendingImages.clear();
  imageCacheBytes = 0;
  imageCacheToken = "";
  imageCacheGeneration += 1;
}

export function requestCachedImage(path: string): Promise<Blob> {
  const token = getAuthToken();
  if (imageCacheToken !== token) {
    clearImageCache();
    imageCacheToken = token;
  }
  const now = Date.now();
  const cached = imageCache.get(path);
  if (cached && cached.expiresAt > now) {
    imageCache.delete(path);
    imageCache.set(path, cached);
    return Promise.resolve(cached.blob);
  }
  if (cached) {
    imageCache.delete(path);
    imageCacheBytes -= cached.blob.size;
  }
  const pending = pendingImages.get(path);
  if (pending) return pending;
  const generation = imageCacheGeneration;
  const started = performance.now();
  const loading = fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
    .then(async (response) => {
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw Object.assign(new Error(payload?.error ?? `API request failed: ${response.status}`), { status: response.status });
      }
      const blob = await response.blob();
      const durationMs = Math.round(performance.now() - started);
      if (durationMs > 1000) console.info("[image-load]", {
        variant: path.includes("size=thumbnail") ? "thumbnail" : "original",
        durationMs, bytes: blob.size, serverTiming: response.headers.get("Server-Timing")
      });
      if (generation === imageCacheGeneration && blob.size <= imageCacheLimit / 2) {
        imageCache.set(path, { blob, expiresAt: Date.now() + 300_000 });
        imageCacheBytes += blob.size;
        while (imageCacheBytes > imageCacheLimit) {
          const oldest = imageCache.keys().next().value;
          if (!oldest) break;
          imageCacheBytes -= imageCache.get(oldest)!.blob.size;
          imageCache.delete(oldest);
        }
      }
      return blob;
    })
    .finally(() => {
      if (generation === imageCacheGeneration) pendingImages.delete(path);
    });
  pendingImages.set(path, loading);
  return loading;
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
