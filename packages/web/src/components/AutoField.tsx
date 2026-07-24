/**
 * AutoField — schema-driven form field.
 *
 * Given a `{ schemaKey, schema, value, onChange }` it dispatches on
 * `schema.type` to render the right control:
 *   boolean → checkbox   select → <select> dropdown
 *   number  → number input  text → <textarea>
 *   list    → comma-separated input   (default) → text input
 *
 * A human label is auto-derived from the dotted key path:
 * "agent.max_tokens" → "Max tokens".
 *
 * Port of Hermes AutoField, simplified to mya's native HTML controls (mya has
 * no Switch/Select/Input component primitives, so we use styled native
 * elements with the shared `.input` class).
 */

export interface AutoFieldSchema {
  /** Field control type. */
  type?: "boolean" | "select" | "number" | "text" | "list" | string;
  /** Options for `select`. */
  options?: string[];
  /** Inline help text shown beneath the label. */
  description?: string;
  [key: string]: unknown;
}

export interface AutoFieldProps {
  /** Dotted key path, e.g. "agent.max_tokens". Last segment → label. */
  schemaKey: string;
  schema: AutoFieldSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}

/** Derive a human label from a dotted key path. Exported for testing.
 *  "agent.max_tokens" → "Max tokens" (first letter capitalised, _ → space). */
export function fieldLabel(schemaKey: string): string {
  const spaced = (schemaKey.split(".").pop() ?? schemaKey).replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function Hint({ schema, schemaKey }: { schema: AutoFieldSchema; schemaKey: string }) {
  const keyPath = schemaKey.includes(".") ? schemaKey : "";
  const description =
    typeof schema.description === "string" && schema.description ? schema.description : "";
  if (!keyPath && !description) return null;
  return <span className="text-xs text-fg-subtle">{description || keyPath}</span>;
}

export function AutoField({ schemaKey, schema, value, onChange }: AutoFieldProps) {
  const label = fieldLabel(schemaKey);

  if (schema.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-4 py-1">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-fg">{label}</span>
          <Hint schema={schema} schemaKey={schemaKey} />
        </div>
        <input
          type="checkbox"
          className="h-4 w-4 accent-accent cursor-pointer"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          data-field={schemaKey}
        />
      </div>
    );
  }

  if (schema.type === "select") {
    const options = Array.isArray(schema.options) ? schema.options : [];
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-fg">{label}</span>
        <Hint schema={schema} schemaKey={schemaKey} />
        <select
          className="input"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          data-field={schemaKey}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt || "(none)"}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (schema.type === "number") {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-fg">{label}</span>
        <Hint schema={schema} schemaKey={schemaKey} />
        <input
          type="number"
          className="input"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(0);
              return;
            }
            const n = Number(raw);
            if (!Number.isNaN(n)) onChange(n);
          }}
          data-field={schemaKey}
        />
      </div>
    );
  }

  if (schema.type === "text") {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-fg">{label}</span>
        <Hint schema={schema} schemaKey={schemaKey} />
        <textarea
          className="input min-h-[80px] resize-y"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          data-field={schemaKey}
        />
      </div>
    );
  }

  if (schema.type === "list") {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-fg">{label}</span>
        <Hint schema={schema} schemaKey={schemaKey} />
        <input
          type="text"
          className="input"
          value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          placeholder="comma-separated values"
          data-field={schemaKey}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-fg">{label}</span>
      <Hint schema={schema} schemaKey={schemaKey} />
      <input
        type="text"
        className="input"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        data-field={schemaKey}
      />
    </div>
  );
}
