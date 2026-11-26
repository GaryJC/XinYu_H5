import { Alert, Button, Dropdown, Image, message } from "antd";
import { cloneElement, useLayoutEffect, useState, type ReactElement, type ReactNode } from "react";

import { canCopyImage, copyImage, ImageClipboardUnavailableError } from "../browser/copyImage";
import { downloadImage } from "../browser/downloadImage";

const isMobileClient = () => /Android|iPhone|iPad|iPod|HarmonyOS/i.test(navigator.userAgent);
export const isDesktopDingTalk = () => !isMobileClient() && /DingTalk/i.test(navigator.userAgent);

export function PhotoPreviewActions({ source, children }: { source: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      if (!isMobileClient()) {
        downloadImage(source);
        return;
      }
      const match = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(source);
      if (!match) throw new Error("图片尚未加载完成，请重新打开预览。");
      const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
      const extension = match[1].split("/")[1].replace("jpeg", "jpg");
      const file = new File([bytes], `照片.${extension}`, { type: match[1] });
      // Keep share in the click's activation: no asynchronous fetch before it.
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file] });
      } else if (/Android|iPhone|iPad|iPod|HarmonyOS/i.test(navigator.userAgent)) {
        throw new Error("当前钉钉版本不支持系统分享，请在手机浏览器中打开后保存；也请检查钉钉的相册权限。");
      } else {
        const link = document.createElement("a");
        link.href = source;
        link.download = file.name;
        link.click();
      }
    } catch (reason) {
      if (!(reason instanceof Error && reason.name === "AbortError")) {
        setError(reason instanceof Error ? reason.message : "保存失败，请检查相册权限或在手机浏览器中打开。");
      }
    } finally { setBusy(false); }
  }
  return <div style={{ maxWidth: "calc(100vw - 32px)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
    {error && <Alert type="error" title={error} showIcon />}
    <Button onClick={send} loading={busy} disabled={!source}>{isMobileClient() ? "发送到 / 保存图片" : "下载图片"}</Button>
    {children}
  </div>;
}

function NativeCopyImage({ blob, children }: { blob: Blob; children: ReactElement }) {
  const [image, setImage] = useState<{ blob: Blob; url: string }>();
  useLayoutEffect(() => {
    const url = URL.createObjectURL(blob);
    setImage({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  if (image?.blob !== blob) return null;
  // Preserve the preview's image ref, zoom, rotation and pointer handlers.
  return cloneElement(children as ReactElement<{ src: string }>, { src: image.url, key: image.url });
}

export function PhotoContextMenu({ source, blob, children }: { source: string; blob?: Blob; children: ReactElement }) {
  const [messages, holder] = message.useMessage();
  const [busy, setBusy] = useState(false);
  const [clipboardUnavailable, setClipboardUnavailable] = useState(false);
  if (isMobileClient()) return <>{holder}{children}</>;
  if (source && (clipboardUnavailable || !canCopyImage())) {
    // Mac DingTalk also pastes the img's source as text when it is a data URL.
    const useBlob = isDesktopDingTalk() && blob
      && /^image\/(?:jpeg|png|webp|gif|bmp|tiff|heic|heif)$/i.test(blob.type);
    return <>{holder}{useBlob ? <NativeCopyImage blob={blob}>{children}</NativeCopyImage> : children}</>;
  }
  async function copy() {
    if (busy || !source) return;
    setBusy(true);
    try {
      await copyImage(source);
      void messages.success("图片已复制，可粘贴到聊天或 Word");
    } catch (reason) {
      if (reason instanceof ImageClipboardUnavailableError) setClipboardUnavailable(true);
      void messages.error(reason instanceof Error ? reason.message : "复制失败，请保存图片后使用。", 6);
    } finally { setBusy(false); }
  }
  return <>{holder}<Dropdown trigger={["contextMenu"]} styles={{ root: { zIndex: 2000 } }} menu={{
    items: [
      { key: "copy", label: busy ? "正在复制…" : "复制图片", disabled: busy || !source },
      { key: "download", label: "下载图片", disabled: busy || !source }
    ],
    onClick: ({ key }) => {
      if (key === "download") {
        try {
          downloadImage(source);
          void messages.info("已尝试启动下载，请查看下载列表；若没有反应，请在外部浏览器打开后下载。", 6);
        } catch (reason) {
          void messages.error(reason instanceof Error ? reason.message : "下载失败，请在浏览器中打开后保存。", 6);
        }
      } else { void copy(); }
    }
  }}>{children}</Dropdown></>;
}

export function PhotoPreviewGroup({ children }: { children: ReactNode }) {
  return <Image.PreviewGroup preview={{
    imageRender: (original, info) => <PhotoContextMenu source={info.image.url}>{original}</PhotoContextMenu>,
    actionsRender: (actions, info) =>
    <PhotoPreviewActions key={info.image.url} source={info.image.url}>{actions}</PhotoPreviewActions>
  }}>{children}</Image.PreviewGroup>;
}
