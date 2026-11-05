import { downloadBlob } from "./download";

/**
 * Rasterises an inline SVG element (the mind map canvas) into a downloable PNG.
 * The SVG must carry explicit presentation attributes — CSS classes from the
 * page stylesheet are not available inside the detached serialised document.
 */
export async function exportSvgToPng(
  svg: SVGSVGElement,
  fileName: string,
  scale = 2,
): Promise<void> {
  const width = Number(svg.getAttribute("width") ?? 0);
  const height = Number(svg.getAttribute("height") ?? 0);
  if (!width || !height) throw new Error("mind map has no measurable size");

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const markup = new XMLSerializer().serializeToString(clone);
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("mind map could not be rendered"));
    image.src = source;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas is unavailable in this browser");
  context.scale(scale, scale);
  context.drawImage(image, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("mind map could not be encoded");

  downloadBlob(blob, `${fileName}.png`);
}
