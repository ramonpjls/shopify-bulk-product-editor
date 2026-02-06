declare module "*.css";

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: Record<string, unknown> | undefined;
  }
}
