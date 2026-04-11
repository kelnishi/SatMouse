import { useCallback } from "react";
import { useSatMouse } from "../hooks.js";

export interface SettingsPanelProps {
  className?: string;
}

const FLIP_AXES = ["tx", "ty", "tz", "rx", "ry", "rz"] as const;

function mapSlider(v: number): number {
  return 0.0001 * Math.pow(500, v / 100);
}

function unmapSlider(v: number): number {
  return (100 * Math.log(v / 0.0001)) / Math.log(500);
}

export function SettingsPanel({ className }: SettingsPanelProps) {
  const { config, updateConfig } = useSatMouse();

  const onFlip = useCallback(
    (axis: (typeof FLIP_AXES)[number]) => {
      updateConfig({ flip: { ...config.flip, [axis]: !config.flip[axis] } });
    },
    [config.flip, updateConfig],
  );

  return (
    <div className={className}>
      <section data-section="sensitivity">
        <label>
          Translation
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(unmapSlider(config.sensitivity.translation))}
            onChange={(e) =>
              updateConfig({ sensitivity: { ...config.sensitivity, translation: mapSlider(+e.target.value) } })
            }
          />
          <span>{config.sensitivity.translation.toFixed(4)}</span>
        </label>
        <label>
          Rotation
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(unmapSlider(config.sensitivity.rotation))}
            onChange={(e) =>
              updateConfig({ sensitivity: { ...config.sensitivity, rotation: mapSlider(+e.target.value) } })
            }
          />
          <span>{config.sensitivity.rotation.toFixed(4)}</span>
        </label>
      </section>

      <section data-section="flip">
        {FLIP_AXES.map((axis) => (
          <label key={axis}>
            <input
              type="checkbox"
              checked={config.flip[axis]}
              onChange={() => onFlip(axis)}
            />
            {axis.toUpperCase()}
          </label>
        ))}
      </section>

      <section data-section="toggles">
        <label>
          <input
            type="checkbox"
            checked={config.lockPosition}
            onChange={() => updateConfig({ lockPosition: !config.lockPosition })}
          />
          Lock Position
        </label>
        <label>
          <input
            type="checkbox"
            checked={config.lockRotation}
            onChange={() => updateConfig({ lockRotation: !config.lockRotation })}
          />
          Lock Rotation
        </label>
        <label>
          <input
            type="checkbox"
            checked={config.dominant}
            onChange={() => updateConfig({ dominant: !config.dominant })}
          />
          Dominant
        </label>
      </section>

      <section data-section="deadzone">
        <label>
          Dead Zone
          <input
            type="range"
            min={0}
            max={100}
            value={config.deadZone}
            onChange={(e) => updateConfig({ deadZone: +e.target.value })}
          />
          <span>{config.deadZone}</span>
        </label>
      </section>
    </div>
  );
}
