const authTokenKey = "repair-h5-auth-token";
const measuredPaths = /^\/api\/(?:ocr\/(?:vehicle-license|license-plate|vin)|files|company-system\/vehicles\/lookup|work-orders\/[^/]+\/ocr-records)$/;
const imageCache = new Map<string, { blob: Blob; expiresAt: number }>();
const pendingImages = new Map<string, Promise<Blob>>();
const imageCacheLimit = 16 * 1024 * 1024;
let imageCacheBytes = 0;
let imageCacheToken = "";
let imageCacheGeneration = 0;
let sessionToken = window.localStorage.getItem(authTokenKey) || "";
let sessionGeneration = 0;
let sessionReady = true;

type SessionChange = "changed" | "storage" | "expired";
const sessionChangedEvent = "repair-h5-auth-token-changed";

export type RequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  skipAuth?: boolean;
  restoreSession?: boolean;
};

// Keep the deadline active until the response body has been consumed.
async function withDeadline<T>(options: RequestOptions, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const writing = Boolean(options.method && options.method !== "GET");
  const timeoutMs = options.timeoutMs ?? (writing ? 60_000 : 20_000);
  let timedOut = false;
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    if (controller.signal.aborted) throw new Error("cancelled");
    const result = await operation(controller.signal);
    if (controller.signal.aborted) throw new Error("aborted");
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error(timedOut
      ? writing ? "请求超时，提交结果待确认，请先核对记录" : "加载超时，请重试"
      : writing ? "请求已中断，提交结果待确认" : "请求已取消"), { kind: timedOut ? "timeout" : "cancelled" });
    throw error;
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

export function setAuthToken(token: string) {
  window.localStorage.setItem(authTokenKey, token);
  changeSession(token, "changed");
}

export function getAuthToken() {
  return sessionToken;
}

export function clearAuthToken() {
  window.localStorage.removeItem(authTokenKey);
  changeSession("", "changed");
}

export function confirmAuthSession() {
  const generation = sessionGeneration;
  syncStoredSession();
  if (generation !== sessionGeneration) return false;
  sessionReady = true;
  return true;
}

export function subscribeAuthSession(listener: (reason: SessionChange) => void) {
  const changed = (event: Event) => listener((event as CustomEvent<SessionChange>).detail);
  window.addEventListener(sessionChangedEvent, changed);
  return () => window.removeEventListener(sessionChangedEvent, changed);
}

function changeSession(token: string, reason: SessionChange) {
  if (token === sessionToken && reason !== "expired") return;
  sessionToken = token;
  sessionGeneration += 1;
  sessionReady = reason !== "storage";
  clearImageCache();
  window.dispatchEvent(new CustomEvent(sessionChangedEvent, { detail: reason }));
}

function syncStoredSession() {
  const stored = window.localStorage.getItem(authTokenKey) || "";
  if (stored !== sessionToken) changeSession(stored, "storage");
}

window.addEventListener("storage", (event) => {
  if (event.storageArea === window.localStorage && (event.key === authTokenKey || event.key === null)) syncStoredSession();
});

function changedSessionError() {
  return Object.assign(new Error("登录身份已变更，请重新查看当前数据"), { status: 409 });
}

function captureSession(restore = false) {
  const generation = sessionGeneration;
  syncStoredSession();
  if (generation !== sessionGeneration || (!sessionReady && !restore)) throw changedSessionError();
  return { token: sessionToken, generation: sessionGeneration };
}

function checkSession(session: { token: string; generation: number }, status?: number) {
  syncStoredSession();
  if (session.generation !== sessionGeneration) throw changedSessionError();
  if (status === 401 && session.token) {
    window.localStorage.removeItem(authTokenKey);
    changeSession("", "expired");
  }
}

function clearImageCache() {
  imageCache.clear();
  pendingImages.clear();
  imageCacheBytes = 0;
  imageCacheToken = "";
  imageCacheGeneration += 1;
}

export function requestCachedImage(path: string): Promise<Blob> {
  let session: ReturnType<typeof captureSession>;
  try { session = captureSession(); } catch (error) { return Promise.reject(error); }
  const { token } = session;
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
  const loading = withDeadline({ timeoutMs: 120_000 }, signal => fetch(path, { signal, headers: token ? { Authorization: `Bearer ${token}` } : undefined })
    .then(async (response) => {
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        checkSession(session, response.status);
        throw Object.assign(new Error(payload?.error ?? `API request failed: ${response.status}`), { status: response.status });
      }
      const blob = await response.blob();
      checkSession(session);
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
    }))
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

    const session = options.skipAuth ? undefined : captureSession(options.restoreSession);
    const token = session?.token || "";
    if (token) headers.Authorization = `Bearer ${token}`;

    return await withDeadline({ ...options, timeoutMs: options.timeoutMs ?? (/\/(?:ocr|files)(?:\/|$)|photos|print-pdf|export/.test(path) ? 120_000 : undefined) }, async signal => {
    response = await fetch(path, {
      signal,
      method: options.method ?? "GET",
      headers: Object.keys(headers).length ? headers : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    const payload = await response.json().catch(() => null);
    if (session) checkSession(session, response.status);
    if (!response.ok) {
      throw Object.assign(new Error(payload?.error ?? `API request failed: ${response.status}`), { status: response.status });
    }
    succeeded = true;
    return payload as T;
    });
  } finally {
    if (measured) console.info("[ocr-request]", {
      path, durationMs: Math.round(performance.now() - started),
      status: response?.status, succeeded,
      requestId: response?.headers.get("X-Request-Id"),
      serverTiming: response?.headers.get("Server-Timing")
    });
  }
}

export async function requestBlob(path: string, options: Pick<RequestOptions, "signal" | "timeoutMs"> = {}): Promise<Blob> {
  return withDeadline({timeoutMs:120_000,...options}, async signal => {
  const session = captureSession();
  const { token } = session;
  const response = await fetch(path, {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    checkSession(session, response.status);
    throw Object.assign(new Error(payload?.error ?? `API request failed: ${response.status}`), { status: response.status });
  }
  const blob = await response.blob();
  checkSession(session);
  return blob;
  });
}
