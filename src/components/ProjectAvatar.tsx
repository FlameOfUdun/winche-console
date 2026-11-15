import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import logoUrl from "../assets/winche-logo.png";

/** The project's thumbnail as an object URL (null while loading or when there's none). */
export function useProjectImage(version: string | null | undefined, consoleUrl?: string): string | null {
  const image = useQuery({ queryKey: ["project-image", consoleUrl ?? "", version], queryFn: () => api.projectImage(version!, consoleUrl), enabled: !!version, staleTime: Infinity });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!image.data) { setUrl(null); return; }
    const u = URL.createObjectURL(image.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [image.data]);
  return version ? url : null;
}

/** The project's thumbnail, or Winche's logo when it has none. */
export function ProjectAvatar({ version, consoleUrl, size = 32, radius = 8 }: {
  version: string | null | undefined; consoleUrl?: string; size?: number; radius?: number;
}) {
  const url = useProjectImage(version, consoleUrl);
  return (
    <img src={url ?? logoUrl} alt="" width={size} height={size} data-testid="project-avatar"
      style={{ borderRadius: radius, display: "block", flexShrink: 0, objectFit: "cover" }} />
  );
}

/**
 * [file] as a square [size]×[size] image, cropped to its middle: what the project's thumbnail is stored as (WebP where
 * the browser can write it, else PNG).
 */
export async function squareThumbnail(file: Blob, size = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize images.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  const webp = await toBlob("image/webp");
  const blob = webp?.type === "image/webp" ? webp : await toBlob("image/png");
  if (!blob) throw new Error("Couldn't read that image.");
  return blob;
}
