import type { ThemeMode } from "../hooks/useTheme";
import { Icon, type IconName } from "./ui/Icon";

const LABELS: Record<ThemeMode, string> = { light: "Light", dark: "Dark", system: "System" };
const ICONS: Record<ThemeMode, IconName> = { light: "sun", dark: "moon", system: "monitor" };
const NEXT: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "system", system: "light" };

export function ThemeToggle({ theme, onCycle }: { theme: ThemeMode; onCycle: () => void }) {
  return <button type="button" className="theme-toggle" aria-label={`Theme: ${LABELS[theme]}`} title={`Switch to ${LABELS[NEXT[theme]].toLowerCase()} theme`} onClick={onCycle}>
    <Icon name={ICONS[theme]} />
    <span className="theme-toggle-label">{LABELS[theme]}</span>
  </button>;
}
