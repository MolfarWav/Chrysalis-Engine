/** The bridge host script (client/public/app-bridge-host.js) is loaded by
 *  index.html before the bundle; this is its contract. */
declare global {
  interface Window {
    ChrysalisBridgeHost: {
      frameSrc(appId: string, username: string): string;
      serve(iframe: HTMLIFrameElement, appId: string, username: string, trusted?: boolean): () => void;
      allowedRequest(appId: string, method: string, path: string, trusted?: boolean): boolean;
      eventAllowed(appId: string, trusted: boolean, raw: string): boolean;
      storageKey(username: string, appId: string): string;
      /** The bridge's allowlist for app-to-shell actions: the cleaned request, or null. */
      shellRequest(trusted: boolean, d: unknown): ShellRequest | null;
      /** Set by the shell: answers an app's allowed shell action (throw to refuse). */
      onShellRequest?: (appId: string, req: ShellRequest) => unknown;
    };
    /** In-browser app builder (src/builder/browser/host.ts, /client/builder/host.js). */
    ChrysalisBuilder?: {
      watch(
        appId: string,
        onStatus: (s: AppBuildStatus) => void,
        onReload: () => void,
      ): { ready: Promise<void>; dispose(): void };
      rebuild(appId: string): Promise<void>;
    };
  }
  type ShellRequest = { op: "ask-molfar"; text: string } | { op: "apps" } | { op: "open-app"; appId: string };
  interface AppBuildStatus {
    phase: "checking" | "building" | "ready" | "error" | "waiting";
    message?: string;
    errors?: Array<{ text: string; file?: string; line?: number; column?: number; lineText?: string }>;
  }
}

export {};
