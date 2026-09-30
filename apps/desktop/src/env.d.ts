/// <reference types="vite/client" />
import type { DesktopAPI } from '../../../packages/shared/src/index.js';
declare global {
  interface Window {
    desktop: DesktopAPI;
    MonacoEnvironment?: { getWorker: (_moduleId: string, label: string) => Worker };
  }
}
export {};
