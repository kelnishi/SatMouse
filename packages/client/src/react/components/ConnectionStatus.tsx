import { useSatMouse } from "../hooks.js";

export interface ConnectionStatusProps {
  className?: string;
}

export function ConnectionStatus({ className }: ConnectionStatusProps) {
  const { state, protocol } = useSatMouse();

  return (
    <div className={className} data-state={state}>
      <span data-role="dot" data-state={state} />
      <span data-role="text">{state === "connected" ? "Connected" : state === "connecting" ? "Connecting..." : "Disconnected"}</span>
      {protocol !== "none" && <span data-role="protocol">{protocol}</span>}
    </div>
  );
}
