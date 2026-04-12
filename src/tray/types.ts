export interface TrayActions {
  onOpenClient: () => void;
  onRescanDevices: () => void;
  onQuit: () => void;
}

export interface Tray {
  start(actions: TrayActions): void | Promise<void>;
  stop(): void;
}
