import { useCallback, useEffect, useRef, useState } from "react";
import { useSatMouse } from "../hooks.js";
import { launchSatMouse } from "../../core/launch.js";
import type { DeviceInfo as DeviceInfoType } from "../../core/types.js";

export interface DeviceInfoProps {
  className?: string;
  /** Timeout in ms before showing "no device". Default: 5000 */
  timeout?: number;
}

type FetchState = "loading" | "connected" | "empty" | "error";

export function DeviceInfo({ className, timeout = 5000 }: DeviceInfoProps) {
  const { manager, state } = useSatMouse();
  const [devices, setDevices] = useState<DeviceInfoType[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>("loading");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const poll = useCallback(
    (bridgeConnected: boolean) => {
      if (!bridgeConnected) {
        setFetchState("loading");
        return;
      }

      setFetchState("loading");
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      timeoutRef.current = setTimeout(() => {
        setFetchState("empty");
      }, timeout);

      manager
        .fetchDeviceInfo()
        .then((result) => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setDevices(result);
          setFetchState(result.length > 0 ? "connected" : "empty");
        })
        .catch(() => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setFetchState("error");
        });
    },
    [manager, timeout],
  );

  useEffect(() => {
    poll(state === "connected");

    const onStatus = () => poll(true);
    manager.on("deviceStatus", onStatus);
    return () => {
      manager.off("deviceStatus", onStatus);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [manager, state, poll]);

  if (fetchState === "loading" && state !== "connected") {
    return (
      <div className={className} data-state="loading">
        <span data-role="message">Waiting for bridge...</span>
        <span
          data-role="launch"
          onClick={() => launchSatMouse()}
          role="button"
          tabIndex={0}
        >
          Launch SatMouse
        </span>
      </div>
    );
  }

  if (fetchState === "loading") {
    return (
      <div className={className} data-state="loading">
        <span data-role="message">Detecting devices...</span>
      </div>
    );
  }

  if (fetchState === "error" || fetchState === "empty") {
    return (
      <div className={className} data-state="empty">
        <span data-role="message">No device connected</span>
        <span
          data-role="hint"
          onClick={() => poll(state === "connected")}
          role="button"
          tabIndex={0}
        >
          Click to retry
        </span>
      </div>
    );
  }

  return (
    <div className={className} data-state="connected">
      {devices.map((d) => (
        <div key={d.id} data-role="device">
          <span data-role="model">{d.model ?? d.name}</span>
          <span data-role="vendor">{d.vendor}</span>
          <span data-role="connection">{formatConnectionType(d.connectionType)}</span>
        </div>
      ))}
    </div>
  );
}

function formatConnectionType(type?: string): string {
  switch (type) {
    case "usb":
      return "USB";
    case "wireless":
      return "Wireless";
    case "bluetooth":
      return "Bluetooth";
    default:
      return "";
  }
}
