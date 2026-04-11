import { useEffect, useRef, useState } from "react";
import { useSatMouse, useRawSpatialData } from "../hooks.js";

export interface DebugPanelProps {
  className?: string;
}

export function DebugPanel({ className }: DebugPanelProps) {
  const { state, protocol } = useSatMouse();
  const raw = useRawSpatialData();
  const [fps, setFps] = useState(0);
  const countRef = useRef(0);

  useEffect(() => {
    countRef.current++;
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setFps(countRef.current);
      countRef.current = 0;
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={className}>
      <div data-role="connection">
        <span data-role="label">State</span>
        <span data-role="value">{state}</span>
      </div>
      <div data-role="connection">
        <span data-role="label">Protocol</span>
        <span data-role="value">{protocol}</span>
      </div>
      <div data-role="connection">
        <span data-role="label">Rate</span>
        <span data-role="value">{fps} fps</span>
      </div>
      {raw && (
        <>
          <div data-role="axis"><span>TX</span><span>{Math.round(raw.translation.x)}</span></div>
          <div data-role="axis"><span>TY</span><span>{Math.round(raw.translation.y)}</span></div>
          <div data-role="axis"><span>TZ</span><span>{Math.round(raw.translation.z)}</span></div>
          <div data-role="axis"><span>RX</span><span>{Math.round(raw.rotation.x)}</span></div>
          <div data-role="axis"><span>RY</span><span>{Math.round(raw.rotation.y)}</span></div>
          <div data-role="axis"><span>RZ</span><span>{Math.round(raw.rotation.z)}</span></div>
        </>
      )}
    </div>
  );
}
