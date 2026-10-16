import { Image, Skeleton } from "antd";
import { useEffect, useState } from "react";
import { PhotoPreviewActions } from "./PhotoPreviewGroup";
import { requestBlob } from "../api/httpClient";

type AuthenticatedImageProps = {
  fileId: string;
  alt: string;
  width: number | string;
  height: number | string;
};

export function AuthenticatedImage({ fileId, alt, width, height }: AuthenticatedImageProps) {
  const [source, setSource] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setSource("");
    setError("");

    void requestBlob(`/api/files/${encodeURIComponent(fileId)}/content`)
      .then((blob) => new Promise<string>((resolve, reject) => {
        // Native WebView image menus cannot resolve browser-owned blob URLs.
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("图片加载失败"));
        reader.readAsDataURL(blob);
      }))
      .then((url) => { if (active) setSource(url); })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "图片加载失败");
      });

    return () => {
      active = false;
    };
  }, [fileId]);

  if (error) {
    return <div className="authenticated-image-error" role="alert" title={error}>图片加载失败</div>;
  }

  if (!source) {
    return <Skeleton.Image active style={{ width, height }} />;
  }

  return <Image width={width} height={height} src={source} alt={alt} preview={{ actionsRender: (actions, info) => <PhotoPreviewActions source={info.image.url}>{actions}</PhotoPreviewActions> }} />;
}
