import type { ReactElement, SVGProps } from "react";

export type IconName =
  | "alert" | "audio" | "check" | "chevron" | "clock" | "close" | "download" | "file" | "gauge" | "key"
  | "monitor" | "moon" | "pause" | "play" | "refresh" | "settings" | "spark" | "stop" | "sun" | "trash"
  | "user" | "volume" | "volume-off";

const paths: Record<IconName, ReactElement> = {
  alert: <><path d="M12 4 2.7 20h18.6z" /><path d="M12 10v4M12 17.5v.01" /></>,
  audio: <><path d="M4 10v4" /><path d="M8 7v10" /><path d="M12 4v16" /><path d="M16 8v8" /><path d="M20 10v4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  file: <><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v5h5" /><path d="M9 13h6M9 17h6" /></>,
  gauge: <><path d="M4.5 18a9 9 0 1 1 15 0" /><path d="m12 14 4.5-4.5" /><circle cx="12" cy="15" r="1.6" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M15 8l3 3M17 6l2 2" /></>,
  monitor: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M9 21h6M12 17v4" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  pause: <><path d="M8 5v14" /><path d="M16 5v14" /></>,
  play: <path d="m8 5 11 7-11 7z" />,
  refresh: <><path d="M20 6v5h-5" /><path d="M4 18v-5h5" /><path d="M6.1 9A7 7 0 0 1 18 7l2 4M4 13l2 4a7 7 0 0 0 11.9-2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  spark: <><path d="m12 3 1.3 4.7L18 9l-4.7 1.3L12 15l-1.3-4.7L6 9l4.7-1.3z" /><path d="m18 15 .7 2.3L21 18l-2.3.7L18 21l-.7-2.3L15 18l2.3-.7z" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 3h6l1 4H8z" /><path d="m7 7 1 14h8l1-14M10 11v6M14 11v6" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  volume: <><path d="M11 5 6.5 9H3v6h3.5L11 19z" /><path d="M15.2 9.2a4 4 0 0 1 0 5.6M18 6.5a8 8 0 0 1 0 11" /></>,
  "volume-off": <><path d="M11 5 6.5 9H3v6h3.5L11 19z" /><path d="m16 10 5 4M21 10l-5 4" /></>
};

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg {...props} data-icon={name} className={`icon ${props.className || ""}`.trim()} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
