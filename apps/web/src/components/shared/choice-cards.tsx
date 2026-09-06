import type { ReactNode } from "react";

export type ChoiceCardOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

export function ChoiceCards({
  legend,
  name,
  choices,
  defaultValue,
  required = false,
  columns = 3,
  onValueChange,
}: {
  legend: ReactNode;
  name: string;
  choices: ReadonlyArray<ChoiceCardOption>;
  defaultValue?: string;
  required?: boolean;
  columns?: 2 | 3 | 4;
  onValueChange?: (value: string) => void;
}) {
  const grid = columns === 4
    ? "sm:grid-cols-4"
    : columns === 2
      ? "sm:grid-cols-2"
      : "sm:grid-cols-3";

  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-semibold text-ink">{legend}</legend>
      <div className={`mt-1.5 grid gap-2 ${grid}`}>
        {choices.map((choice, index) => {
          const checked = defaultValue === undefined
            ? index === 0
            : choice.value === defaultValue;
          return (
            <label key={`${name}-${choice.value || "empty"}`} className="group relative min-w-0 cursor-pointer">
              <input
                type="radio"
                name={name}
                value={choice.value}
                defaultChecked={checked}
                required={required}
                disabled={choice.disabled}
                onChange={() => onValueChange?.(choice.value)}
                className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              />
              <span className="flex min-h-12 min-w-0 flex-col justify-center rounded-xl border border-line bg-layer-2 px-3 py-2 text-left transition group-hover:border-primary/60 group-hover:bg-accent-subtle peer-checked:border-primary peer-checked:bg-accent-subtle peer-checked:ring-2 peer-checked:ring-primary/15 peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-disabled:cursor-not-allowed peer-disabled:opacity-40">
                <strong className="truncate text-xs text-ink">{choice.label}</strong>
                {choice.description ? <span className="mt-0.5 truncate text-[10px] text-ink-soft">{choice.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
