import { useEffect, useState } from "react";
import { useSatMouse } from "../hooks.js";
import type { DeviceInfo as DeviceInfoType } from "../../core/types.js";

export interface DeviceInfoProps {
  className?: string;
}

export function DeviceInfo({ className }: DeviceInfoProps) {
  const { manager, state } = useSatMouse();
  const [devices, setDevices] = useState<DeviceInfoType[]>([]);

  useEffect(() => {
    if (state !== "connected") return;
    manager.fetchDeviceInfo().then(setDevices).catch(() => {});

    const onStatus = () => {
      manager.fetchDeviceInfo().then(setDevices).catch(() => {});
    };
    manager.on("deviceStatus", onStatus);
    return () => { manager.off("deviceStatus", onStatus); };
  }, [manager, state]);

  if (devices.length === 0) {
    return <div className={className} data-empty="true">No devices</div>;
  }

  return (
    <div className={className}>
      {devices.map((d) => (
        <div key={d.id} data-role="device">
          <span data-role="name">{d.name}</span>
          <span data-role="id">{d.id}</span>
        </div>
      ))}
    </div>
  );
}
