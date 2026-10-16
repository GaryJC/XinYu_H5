import { Image, Skeleton } from "antd";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { requestCachedImage } from "../api/httpClient";
import { PhotoPreviewActions } from "./PhotoPreviewGroup";

type AuthenticatedImageProps = {
  fileId: string;
  alt: string;
  width: number | string;
  height: number | string;
};

type PreviewContext = {
  fullSources: Record<string, string>;
  loadFull: (fileId: string) => void;
  setThumbnail: (fileId: string, url: string) => void;
};

const previewContext = createContext<PreviewContext | null>(null);

function useAuthRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((value) => value + 1);
    window.addEventListener("repair-h5-auth-token-changed", changed);
    return () => window.removeEventListener("repair-h5-auth-token-changed", changed);
  }, []);
  return revision;
}

function imagePath(fileId: string, thumbnail = false) {
  return `/api/files/${encodeURIComponent(fileId)}/content${thumbnail ? "?size=thumbnail" : ""}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    // DingTalk's native image menu cannot resolve browser-owned blob URLs.
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片加载失败"));
    reader.readAsDataURL(blob);
  });
}

export function AuthenticatedImagePreviewGroup({ fileIds, children }: { fileIds: string[]; children: ReactNode }) {
  const authRevision = useAuthRevision();
  const [fullSources, setFullSources] = useState<Record<string, string>>({});
  const [thumbnailSources, setThumbnailSources] = useState<Record<string, string>>({});
  const urls = useRef(new Map<string, string>());
  const pending = useRef(new Set<string>());
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    setFullSources({});
    setThumbnailSources({});
    return () => {
      generation.current += 1;
      urls.current.clear();
      pending.current.clear();
    };
  }, [authRevision]);

  function loadFull(fileId: string) {
    if (!fileId || urls.current.has(fileId) || pending.current.has(fileId)) return;
    pending.current.add(fileId);
    const currentGeneration = generation.current;
    void requestCachedImage(imagePath(fileId)).then(blobToDataUrl).then((url) => {
      if (currentGeneration !== generation.current) return;
      urls.current.set(fileId, url);
      setFullSources((current) => ({ ...current, [fileId]: url }));
    }).catch(() => {
      // The thumbnail stays visible if the full image cannot be loaded.
    }).finally(() => { if (currentGeneration === generation.current) pending.current.delete(fileId); });
  }

  function setThumbnail(fileId: string, url: string) {
    setThumbnailSources((current) => {
      if (url && current[fileId] === url) return current;
      if (!url && !current[fileId]) return current;
      const next = { ...current };
      if (url) next[fileId] = url;
      else delete next[fileId];
      return next;
    });
  }

  return <previewContext.Provider value={{ fullSources, loadFull, setThumbnail }}>
    <Image.PreviewGroup items={fileIds.map((fileId) => fullSources[fileId] || thumbnailSources[fileId] || "")} preview={{
      onOpenChange: (open, info) => { if (open) loadFull(fileIds[info.current ?? 0]); },
      onChange: (current) => loadFull(fileIds[current]),
      actionsRender: (actions, info) => <PhotoPreviewActions source={fullSources[fileIds[info.current ?? 0]] || ""}>{actions}</PhotoPreviewActions>
    }}>{children}</Image.PreviewGroup>
  </previewContext.Provider>;
}

export function AuthenticatedImage({ fileId, alt, width, height }: AuthenticatedImageProps) {
  const authRevision = useAuthRevision();
  const group = useContext(previewContext);
  const [source, setSource] = useState("");
  const [fullSource, setFullSource] = useState("");
  const [error, setError] = useState("");
  const fullUrl = useRef("");
  const fullPending = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    let active = true;
    setSource("");
    setError("");
    setFullSource("");
    fullPending.current = false;
    void requestCachedImage(imagePath(fileId, true))
      .then(blobToDataUrl)
      .then((nextUrl) => {
        if (!active) return;
        setSource(nextUrl);
        group?.setThumbnail(fileId, nextUrl);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "图片加载失败");
      });
    return () => {
      generation.current += 1;
      active = false;
      group?.setThumbnail(fileId, "");
      fullUrl.current = "";
      fullPending.current = false;
    };
  }, [fileId, authRevision]);

  function loadFull() {
    if (group) {
      group.loadFull(fileId);
      return;
    }
    if (fullUrl.current || fullPending.current) return;
    fullPending.current = true;
    const currentGeneration = generation.current;
    void requestCachedImage(imagePath(fileId)).then(blobToDataUrl).then((nextUrl) => {
      if (currentGeneration !== generation.current) return;
      fullUrl.current = nextUrl;
      setFullSource(nextUrl);
    }).catch(() => {
      // Keep the thumbnail visible if the full image cannot be loaded.
    }).finally(() => { if (currentGeneration === generation.current) fullPending.current = false; });
  }

  return <div className="authenticated-image" style={{ width, height }}>
    <Image width={width} height={height} src={source || undefined} alt={alt}
      placeholder={!source ? <Skeleton.Image active style={{ width, height }} /> : undefined}
      preview={{ src: group?.fullSources[fileId] || fullSource || source,
        actionsRender: group ? undefined : (actions) => <PhotoPreviewActions source={fullSource}>{actions}</PhotoPreviewActions> }}
      onClick={loadFull}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") loadFull(); }} />
    {error ? <div className="authenticated-image-error" role="alert" title={error}>图片加载失败</div> : null}
  </div>;
}
