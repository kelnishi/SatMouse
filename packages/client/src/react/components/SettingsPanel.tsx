import { useSatMouse } from "../hooks.js";

export interface SettingsPanelProps {
  className?: string;
}

export function SettingsPanel({ className }: SettingsPanelProps) {
  const { config, updateConfig } = useSatMouse();

  return (
    <div className={className}>
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
