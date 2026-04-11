import { createContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SatMouseConnection, type ConnectionState, type ConnectOptions, type TransportProtocol } from "../core/index.js";
import { InputManager, type InputConfig } from "../utils/index.js";

export interface SatMouseContextValue {
  manager: InputManager;
  state: ConnectionState;
  protocol: TransportProtocol;
  config: InputConfig;
  updateConfig: (partial: Partial<InputConfig>) => void;
}

export const SatMouseContext = createContext<SatMouseContextValue | null>(null);

export interface SatMouseProviderProps {
  connectOptions?: ConnectOptions;
  config?: Partial<InputConfig>;
  autoConnect?: boolean;
  children: ReactNode;
}

export function SatMouseProvider({
  connectOptions,
  config: configOverrides,
  autoConnect = true,
  children,
}: SatMouseProviderProps) {
  const managerRef = useRef<InputManager | null>(null);

  if (!managerRef.current) {
    const connection = new SatMouseConnection(connectOptions);
    const manager = new InputManager(configOverrides);
    manager.addConnection(connection);
    managerRef.current = manager;
  }
  const manager = managerRef.current;

  const [state, setState] = useState<ConnectionState>("disconnected");
  const [protocol, setProtocol] = useState<TransportProtocol>("none");
  const [config, setConfig] = useState<InputConfig>(manager.config);

  useEffect(() => {
    const onState = (s: ConnectionState, p: TransportProtocol) => {
      setState(s);
      setProtocol(p);
    };
    const onConfig = (c: InputConfig) => setConfig({ ...c });

    manager.on("stateChange", onState);
    manager.on("configChange", onConfig);

    if (autoConnect) manager.connect();

    return () => {
      manager.off("stateChange", onState);
      manager.off("configChange", onConfig);
      manager.disconnect();
    };
  }, [manager, autoConnect]);

  const value = useMemo<SatMouseContextValue>(
    () => ({
      manager,
      state,
      protocol,
      config,
      updateConfig: (partial) => manager.updateConfig(partial),
    }),
    [manager, state, protocol, config],
  );

  return <SatMouseContext value={value}>{children}</SatMouseContext>;
}
