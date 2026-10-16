import { Alert, Button, Image } from "antd";
import { useState, type ReactNode } from "react";

export function PhotoPreviewActions({ source, children }: { source: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const match = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(source);
      if (!match) throw new Error("图片尚未加载完成，请重新打开预览。");
      const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
      const extension = match[1].split("/")[1].replace("jpeg", "jpg");
      const file = new File([bytes], `照片.${extension}`, { type: match[1] });
      // Keep share in the click's activation: no asynchronous fetch before it.
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file] });
      } else if (/Android|iPhone|iPad|DingTalk/i.test(navigator.userAgent)) {
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
    <Button onClick={send} loading={busy}>发送到 / 保存图片</Button>
    {children}
  </div>;
}

export function PhotoPreviewGroup({ children }: { children: ReactNode }) {
  return <Image.PreviewGroup preview={{ actionsRender: (actions, info) =>
    <PhotoPreviewActions key={info.image.url} source={info.image.url}>{actions}</PhotoPreviewActions>
  }}>{children}</Image.PreviewGroup>;
}
