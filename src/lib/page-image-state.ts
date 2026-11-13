import { DEFAULT_RED_SENSITIVITY, type RedSensitivity } from "@/lib/image-process";

/** 1枚目／2枚目それぞれの前処理済み画像状態 */
export type PageImageState = {
  sourceFile: File | null;
  colorUrl: string | null;
  redUrl: string | null;
  redSensitivity: RedSensitivity;
  sensitivityBusy: boolean;
};

export function emptyPageImage(): PageImageState {
  return {
    sourceFile: null,
    colorUrl: null,
    redUrl: null,
    redSensitivity: DEFAULT_RED_SENSITIVITY,
    sensitivityBusy: false,
  };
}
