export {};

declare global {
  interface Window {
    playground: {
      openAudioFile: () => Promise<string | null>;
      files?: {
        save: (
          defaultName: string,
          filters: { name: string; extensions: string[] }[],
          dataBase64: string,
        ) => Promise<string | null>;
        openText: (
          filters: { name: string; extensions: string[] }[],
        ) => Promise<{ path: string; text: string } | null>;
        openAudioMulti?: () => Promise<string[]>;
        pickOutputFolder?: () => Promise<string | null>;
        writeIn?: (
          dir: string,
          name: string,
          dataBase64: string,
        ) => Promise<string | null>;
      };
      /**
       * Open an http(s) / ms-settings:* / file:// URL via the OS default
       * handler. Other schemes are refused by the main process.
       */
      shellOpen?: (url: string) => Promise<void>;
      crash?: {
        log: (source: string, message: string) => void;
        openLog: () => Promise<void>;
      };
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<boolean | void>;
        isMaximized?: () => Promise<boolean>;
        close: () => Promise<void>;
        setAlwaysOnTop?: (on: boolean) => Promise<void>;
        setMiniSize?: (mini: boolean) => Promise<void>;
        setFullscreen?: (full: boolean) => Promise<void>;
      };
      platform: string;
      versions: Record<string, string>;
      /**
       * Optional Windows-specific helpers wired through ipcMain. Each may
       * return null if unsupported on the current OS or if the underlying
       * PowerShell helper failed.
       */
      bluetooth?: {
        listDevices: () => Promise<BluetoothDeviceInfo[]>;
      };
      library?: {
        pickFolders: () => Promise<string[]>;
        scan: (folders: string[]) => Promise<LibraryFileEntry[]>;
      };
      audioDevices?: {
        getDefaultOutputName: () => Promise<string | null>;
        listVirtualCables?: () => Promise<string[]>;
      };
      loopback?: {
        setMode: (
          mode: "loopback" | "loopbackWithMute" | "airspace",
        ) => Promise<string>;
      };
      airspace?: {
        setAdblock: (on: boolean) => Promise<{ enabled: boolean; blocked: number }>;
        getAdblockStatus: () => Promise<{ enabled: boolean; blocked: number }>;
      };
      headtrack?: {
        start: (port: number) => Promise<{ running: boolean; port: number; error?: string }>;
        stop: () => Promise<void>;
        status: () => Promise<{ running: boolean; port: number; packets: number }>;
        onData: (cb: (d: HeadTrackData) => void) => () => void;
      };
      remote?: {
        start: (port: number) => Promise<{ port: number; url: string } | null>;
        stop: () => Promise<void>;
        getStatus: () => Promise<{ running: boolean; port: number; url: string } | null>;
        onCommand?: (cb: (cmd: string) => void) => () => void;
      };
      viz?: {
        displays: () => Promise<VizDisplayInfo[]>;
        open: (opts: {
          displayId?: number;
          fullscreen?: boolean;
          alwaysOnTop?: boolean;
          transparent?: boolean;
        }) => Promise<boolean>;
        close: () => Promise<void>;
        isOpen: () => Promise<boolean>;
        setFullscreen: (full: boolean) => Promise<void>;
        sendFrame: (frame: unknown) => void;
        onFrame: (cb: (frame: unknown) => void) => () => void;
        onClosed: (cb: () => void) => () => void;
      };
      system?: {
        getStats: () => Promise<SystemStats>;
        getGpuInfo: () => Promise<SystemGpuInfo>;
      };
      /** Native WinMM MIDI bridge (Electron main). Prefer over Web MIDI on Windows. */
      midi?: {
        list: () => Promise<{
          ok: boolean;
          inputs: { id: string; name: string; port: number }[];
          started: boolean;
          error: string | null;
        }>;
        start: () => Promise<{
          ok: boolean;
          inputs: { id: string; name: string; port: number }[];
          started: boolean;
          error: string | null;
        }>;
        stop: () => Promise<{ ok: boolean }>;
        rescan: () => Promise<{
          ok: boolean;
          inputs: { id: string; name: string; port: number }[];
          started: boolean;
          error: string | null;
        }>;
        onMessage: (cb: (msg: { id: string; name: string; bytes: number[] }) => void) => () => void;
      };
    };
  }

  interface SystemStats {
    cores: number;
    sysCpuPercent: number;
    appCpuPercent: number;
    appRamMB: number;
    sysRamUsedMB: number;
    sysRamTotalMB: number;
    procCount: number;
  }

  interface SystemGpuInfo {
    accelerated: boolean;
    compositing: string;
    rasterization: string;
    webgl: string;
  }

  interface BluetoothDeviceInfo {
    name: string;
    connected: boolean;
    battery: number | null;
    codec: string | null;
  }

  interface VizDisplayInfo {
    id: number;
    label: string;
    width: number;
    height: number;
    primary: boolean;
  }

  interface LibraryFileEntry {
    path: string;
    name: string;
    ext: string;
    size: number;
    mtimeMs: number;
  }

  /** One opentrack-protocol UDP sample (cm / degrees). */
  interface HeadTrackData {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    roll: number;
  }
}
