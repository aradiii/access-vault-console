// Minimal ambient typing for the noVNC RFB client (the package ships no types).
// The package's "exports" field is a single string ("./core/rfb.js"), so the
// only valid import specifier is the bare "@novnc/novnc".
declare module "@novnc/novnc" {
  export default class RFB {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket,
      options?: {
        shared?: boolean;
        credentials?: { username?: string; password?: string; target?: string };
      }
    );
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    background: string;
    viewOnly: boolean;
    focus(options?: FocusOptions): void;
    blur(): void;
    sendCtrlAltDel(): void;
    sendKey(keysym: number | string, code: string, down?: boolean): void;
    clipboardPasteFrom(text: string): void;
    disconnect(): void;
    addEventListener(type: string, listener: (ev: CustomEvent) => void): void;
    removeEventListener(type: string, listener: (ev: CustomEvent) => void): void;
  }
}
