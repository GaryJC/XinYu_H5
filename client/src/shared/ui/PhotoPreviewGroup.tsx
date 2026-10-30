import { Alert, Button, Dropdown, Image, message } from "antd";
import { useState, type ReactElement, type ReactNode } from "react";

import { canCopyImage, copyImage } from "../browser/copyImage";

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
    <Button onClick={send} loading={busy} disabled={!source}>发送到 / 保存图片</Button>
    {children}
  </div>;
}

export function PhotoContextMenu({ source, children }: { source: string; children: ReactElement }) {
  const [messages, holder] = message.useMessage();
  const [busy, setBusy] = useState(false);
  const [nativeMenu, setNativeMenu] = useState(false);
  const desktopDingTalk = /DingTalk/i.test(navigator.userAgent) && !/Android|iPhone|iPad|iPod|HarmonyOS/i.test(navigator.userAgent);
  if (!desktopDingTalk || !canCopyImage() || nativeMenu) return <>{holder}{children}</>;
  async function copy() {
    if (busy || !source) return;
    setBusy(true);
    try {
      await copyImage(source);
      void messages.success("图片已复制，可粘贴到聊天或 Word");
    } catch (reason) {
      void messages.error(reason instanceof Error ? reason.message : "复制失败，请保存图片后使用。", 6);
    } finally { setBusy(false); }
  }
  return <>{holder}<Dropdown trigger={["contextMenu"]} styles={{ root: { zIndex: 2000 } }} menu={{
    items: [
      { key: "copy", label: busy ? "正在复制…" : "复制图片", disabled: busy || !source },
      { key: "native", label: "复制不成功？使用原生右键菜单", disabled: busy }
    ],
    onClick: ({ key }) => {
      if (key === "native") {
        setNativeMenu(true);
        void messages.info("请再次右键点击照片；若菜单提供“复制图片”，请选择该项。没有该项时请使用“发送到 / 保存图片”。", 8);
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
