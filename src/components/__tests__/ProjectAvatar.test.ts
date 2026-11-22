import { expect, test } from "vitest";
import { fallbackType } from "../ProjectAvatar";

test("without WebP: PNG when any pixel is see-through (JPEG would turn it black), JPEG when none is", () => {
  const opaque = [10, 20, 30, 255, 40, 50, 60, 255];
  expect(fallbackType(new Uint8ClampedArray(opaque))).toBe("image/jpeg");
  expect(fallbackType(new Uint8ClampedArray([...opaque, 0, 0, 0, 0]))).toBe("image/png");
  expect(fallbackType(new Uint8ClampedArray([...opaque, 255, 255, 255, 254]))).toBe("image/png");   // barely see-through counts
  expect(fallbackType([255, 0, 0, 128])).toBe("image/png");   // the alpha byte, not the colour
});
