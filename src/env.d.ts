/// <reference types="vite/client" />

/** True in the single-file claude.ai Artifact build (`vite build --mode artifact`). */
declare const __ARTIFACT__: boolean;

declare module 'virtual:sample-models' {
  export const FOX_URL: string;
}

/** The claude.ai Artifact runtime's `downloads` capability (only present inside the Artifact viewer). */
interface ClaudeDownloads {
  save(request: { filename: string; data: string | Blob | ArrayBuffer | ArrayBufferView }): Promise<{
    status: 'saved' | 'delivered';
  }>;
}

interface Window {
  claude?: {
    use(name: 'downloads'): Promise<ClaudeDownloads | null>;
  };
}
