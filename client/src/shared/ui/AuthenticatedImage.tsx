import { Image, Skeleton } from "antd";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { requestCachedImage } from "../api/httpClient";
import { isDesktopDingTalk, PhotoContextMenu, PhotoPreviewActions } from "./PhotoPreviewGroup";

type AuthenticatedImageProps = {
  fileId: string;
  alt: string;
  width: number | string;
  height: number | string;
};

type FullPhoto = { dataUrl: string; blob?: Blob };

type PreviewContext = {
  fullSources: Record<string, FullPhoto>;
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
    // Mobile WebViews use an inline image for long-press and file sharing.
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片加载失败"));
    reader.readAsDataURL(blob);
  });
}

async function loadFullPhoto(fileId: string): Promise<FullPhoto> {
  const blob = await requestCachedImage(imagePath(fileId));
  return { dataUrl: await blobToDataUrl(blob), blob: isDesktopDingTalk() ? blob : undefined };
}

export function AuthenticatedImagePreviewGroup({ fileIds, children }: { fileIds: string[]; children: ReactNode }) {
  const authRevision = useAuthRevision();
  const [fullSources, setFullSources] = useState<Record<string, FullPhoto>>({});
  const [thumbnailSources, setThumbnailSources] = useState<Record<string, string>>({});
  const loadedPhotos = useRef(new Map<string, FullPhoto>());
  const currentPreview=useRef("");
  const pending = useRef(new Set<string>());
  const generation = useRef(0);

  useLayoutEffect(() => {
    generation.current += 1;
    setFullSources({});
    setThumbnailSources({});
    return () => {
      generation.current += 1;
      loadedPhotos.current.clear();
      pending.current.clear();
    };
  }, [authRevision]);

  useLayoutEffect(()=>{
    generation.current++;pending.current.clear();
    const allowed=new Set(fileIds);
    for(const id of loadedPhotos.current.keys())if(!allowed.has(id))loadedPhotos.current.delete(id);
    setFullSources(Object.fromEntries(loadedPhotos.current));
  },[fileIds.join('\0')]);

  function releaseFull() {
    generation.current++;pending.current.clear();loadedPhotos.current.clear();setFullSources({});
  }
  function loadFull(fileId: string) {
    currentPreview.current=fileId;
    if (!fileId || loadedPhotos.current.has(fileId) || pending.current.has(fileId)) return;
    pending.current.add(fileId);
    const currentGeneration = generation.current;
    void loadFullPhoto(fileId).then((photo) => {
      if (currentGeneration !== generation.current) return;
      loadedPhotos.current.set(fileId, photo);
      while(loadedPhotos.current.size>3) {
        const oldest=[...loadedPhotos.current.keys()].find(id=>id!==currentPreview.current);
        if(!oldest)break;
        loadedPhotos.current.delete(oldest);
      }
      setFullSources(Object.fromEntries(loadedPhotos.current));
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
    <Image.PreviewGroup items={fileIds.map((fileId) => fullSources[fileId]?.dataUrl || thumbnailSources[fileId] || "")} preview={{
      imageRender: (original, info) => {
        const photo = fullSources[fileIds[info.current ?? 0]];
        return <PhotoContextMenu source={photo?.dataUrl || ""} blob={photo?.blob}>{original}</PhotoContextMenu>;
      },
      onOpenChange: (open, info) => { if (open) loadFull(fileIds[info.current ?? 0]); else releaseFull(); },
      onChange: (current) => loadFull(fileIds[current]),
      actionsRender: (actions, info) => <PhotoPreviewActions source={fullSources[fileIds[info.current ?? 0]]?.dataUrl || ""}>{actions}</PhotoPreviewActions>
    }}>{children}</Image.PreviewGroup>
  </previewContext.Provider>;
}

export function AuthenticatedImage({ fileId, alt, width, height }: AuthenticatedImageProps) {
  const authRevision = useAuthRevision();
  const group = useContext(previewContext);
  const container=useRef<HTMLDivElement>(null);
  const [visible,setVisible]=useState(false);
  useEffect(()=>{
    if(!('IntersectionObserver' in window)){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}
    },{rootMargin:'240px'});
    if(container.current)observer.observe(container.current);
    return()=>observer.disconnect();
  },[]);
  const [source, setSource] = useState("");
  const [fullPhoto, setFullPhoto] = useState<FullPhoto>();
  const [error, setError] = useState("");
  const fullPending = useRef(false);
  const generation = useRef(0);

  useLayoutEffect(() => {
    generation.current += 1;
    let active = true;
    setSource("");
    setError("");
    setFullPhoto(undefined);
    fullPending.current = false;
    if(!visible)return;
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
      fullPending.current = false;
    };
  }, [fileId, authRevision, visible]);

  function loadFull() {
    if (group) {
      group.loadFull(fileId);
      return;
    }
    if (fullPhoto || fullPending.current) return;
    fullPending.current = true;
    const currentGeneration = generation.current;
    void loadFullPhoto(fileId).then((photo) => {
      if (currentGeneration !== generation.current) return;
      setFullPhoto(photo);
    }).catch(() => {
      // Keep the thumbnail visible if the full image cannot be loaded.
    }).finally(() => { if (currentGeneration === generation.current) fullPending.current = false; });
  }

  return <div ref={container} className="authenticated-image" style={{ width, height }}>
    <Image width={width} height={height} src={source || undefined} alt={alt}
      placeholder={!source ? <Skeleton.Image active style={{ width, height }} /> : undefined}
      preview={{ onOpenChange: open => {if(!group&&!open){generation.current++;fullPending.current=false;setFullPhoto(undefined);}}, src: group?.fullSources[fileId]?.dataUrl || fullPhoto?.dataUrl || source,
        imageRender: group ? undefined : (original) => <PhotoContextMenu source={fullPhoto?.dataUrl || ""} blob={fullPhoto?.blob}>{original}</PhotoContextMenu>,
        actionsRender: group ? undefined : (actions) => <PhotoPreviewActions source={fullPhoto?.dataUrl || ""}>{actions}</PhotoPreviewActions> }}
      onClick={loadFull}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") loadFull(); }} />
    {error ? <div className="authenticated-image-error" role="alert" title={error}>图片加载失败</div> : null}
  </div>;
}
