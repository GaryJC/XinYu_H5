import { Image, Skeleton } from "antd";
import { useEffect, useState } from "react";
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
    let objectUrl = "";
    setSource("");
    setError("");

    void requestBlob(`/api/files/${encodeURIComponent(fileId)}/content`)
      .then((blob) => {
        const nextUrl = URL.createObjectURL(blob);
        if (!active) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        objectUrl = nextUrl;
        setSource(nextUrl);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "图片加载失败");
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);

  if (error) {
    return <div className="authenticated-image-error" role="alert" title={error}>图片加载失败</div>;
  }

  if (!source) {
    return <Skeleton.Image active style={{ width, height }} />;
  }

  return <Image width={width} height={height} src={source} alt={alt} />;
}
