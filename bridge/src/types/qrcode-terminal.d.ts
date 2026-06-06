/** Minimal ambient types for `qrcode-terminal` (no official @types package). */
declare module 'qrcode-terminal' {
  export interface GenerateOptions {
    small?: boolean;
  }
  export function generate(
    input: string,
    options?: GenerateOptions,
    callback?: (output: string) => void,
  ): void;
  export function setErrorLevel(level: 'L' | 'M' | 'Q' | 'H'): void;
  const _default: { generate: typeof generate; setErrorLevel: typeof setErrorLevel };
  export default _default;
}
