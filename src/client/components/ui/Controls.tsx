import type { ButtonHTMLAttributes, ChangeEventHandler, CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import type { SelectOption } from "../../types/contracts";
import { Icon, type IconName } from "./Icon";

/* Inline styles that carry custom properties into CSS (fills, scrubber positions). */
export type CssVars = CSSProperties & { [key: `--${string}`]: string | number };

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`button ${className}`.trim()} />;
}

export function IconButton({ label, icon, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: IconName }) {
  return <button type="button" {...props} aria-label={label} title={label} className={`icon-button ${className}`.trim()}><Icon name={icon} /></button>;
}

export function SelectField({ id, label, options, helper, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { id: string; label: string; options: SelectOption[]; helper?: ReactNode }) {
  return <div className="field"><label className="field-label" htmlFor={id}>{label}</label><select id={id} {...props}>{options.map((option, index) => <option key={`${option.value}-${index}`} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select>{helper && <small className="field-help">{helper}</small>}</div>;
}

export function Checkbox({ id, label, ...props }: InputHTMLAttributes<HTMLInputElement> & { id: string; label: ReactNode }) {
  return <label className="checkline" htmlFor={id}><input id={id} type="checkbox" {...props} /><span>{label}</span></label>;
}

/* CSS chrome wrapped around a real checkbox, so role, checked and disabled stay native. */
export function Switch({ id, label, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { id: string; label: ReactNode }) {
  return <label className={`switch ${className}`.trim()} htmlFor={id}>
    <span className="switch-control">
      <input id={id} type="checkbox" {...props} />
      <span className="switch-track" aria-hidden="true"><span className="switch-knob" /></span>
    </span>
    <span className="switch-label">{label}</span>
  </label>;
}

export function Slider({ id, label, min, max, step, value, disabled, onChange, valueText, helper, badge, className = "" }: {
  id: string;
  label: ReactNode;
  min: number;
  max: number;
  step?: number;
  value: number;
  disabled?: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  valueText?: ReactNode;
  helper?: ReactNode;
  badge?: ReactNode;
  className?: string;
}) {
  const percent = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  const fill: CssVars = { "--range-percent": `${percent}%` };
  return <div className={`slider-field ${className}`.trim()}>
    <div className="slider-head">
      <label htmlFor={id}>{label}</label>
      {badge ? <span className="availability-badge">{badge}</span> : valueText !== undefined ? <output htmlFor={id}>{valueText}</output> : null}
    </div>
    <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={onChange} style={fill} />
    {helper}
  </div>;
}

export function Disclosure({ id, className = "", summary, meta, bodyClassName = "", live = false, children }: {
  id?: string;
  className?: string;
  summary: ReactNode;
  meta?: ReactNode;
  bodyClassName?: string;
  live?: boolean;
  children: ReactNode;
}) {
  return <details id={id} className={`disclosure ${className}`.trim()}>
    <summary className="disclosure-summary">
      <span className="disclosure-title">{summary}</span>
      <span className="disclosure-meta">{meta}</span>
      <Icon name="chevron" className="disclosure-chevron" />
    </summary>
    <div className={`disclosure-body ${bodyClassName}`.trim()} aria-live={live ? "polite" : undefined}>{children}</div>
  </details>;
}

export function FieldPanel({ id, className = "", children, live = false }: { id?: string; className?: string; children: ReactNode; live?: boolean }) {
  return <div id={id} className={className} aria-live={live ? "polite" : undefined}>{children}</div>;
}
