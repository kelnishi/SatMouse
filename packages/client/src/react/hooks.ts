import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { SatMouseContext, type SatMouseContextValue } from "./context.js";
import type { SpatialData, ButtonEvent } from "../core/types.js";

/** Access the SatMouse context. Throws if used outside SatMouseProvider. */
export function useSatMouse(): SatMouseContextValue {
  const ctx = useContext(SatMouseContext);
  if (!ctx) throw new Error("useSatMouse must be used within a <SatMouseProvider>");
  return ctx;
}

/**
 * Subscribe to processed spatial data.
 * Batches updates to requestAnimationFrame to avoid re-rendering at device rate.
 */
export function useSpatialData(): SpatialData | null {
  const { manager } = useSatMouse();
  const [data, setData] = useState<SpatialData | null>(null);
  const latestRef = useRef<SpatialData | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const unsub = manager.onSpatialData((d) => {
      latestRef.current = d;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          setData(latestRef.current);
        });
      }
    });
    return () => {
      unsub();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [manager]);

  return data;
}

/**
 * Subscribe to raw (pre-transform) spatial data.
 * Batches updates to requestAnimationFrame.
 */
export function useRawSpatialData(): SpatialData | null {
  const { manager } = useSatMouse();
  const [data, setData] = useState<SpatialData | null>(null);
  const latestRef = useRef<SpatialData | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const handler = (d: SpatialData) => {
      latestRef.current = d;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          setData(latestRef.current);
        });
      }
    };
    manager.on("rawSpatialData", handler);
    return () => {
      manager.off("rawSpatialData", handler);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [manager]);

  return data;
}

/** Subscribe to button events via callback. Does not trigger re-renders. */
export function useButtonEvent(callback: (event: ButtonEvent) => void): void {
  const { manager } = useSatMouse();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const handler = (e: ButtonEvent) => callbackRef.current(e);
    return manager.onButtonEvent(handler);
  }, [manager]);
}
