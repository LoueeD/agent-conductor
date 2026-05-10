import type { RuntimeError } from "./types";

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: RuntimeError[] };

export type JsonSchemaLike = Record<string, unknown>;

export interface Schema<T> {
  parse(value: unknown, path?: string): ParseResult<T>;
  toJSON(): JsonSchemaLike;
  optional(): Schema<T | undefined>;
  nullable(): Schema<T | null>;
  describe(description: string): Schema<T>;
  refine(predicate: (value: T) => boolean, message: string): Schema<T>;
  _type?: T;
}

export interface StringSchema extends Schema<string> {
  min(length: number, message?: string): StringSchema;
  max(length: number, message?: string): StringSchema;
  regex(pattern: RegExp, message?: string): StringSchema;
}

export interface NumberSchema extends Schema<number> {
  min(value: number, message?: string): NumberSchema;
  max(value: number, message?: string): NumberSchema;
}

export interface ArraySchema<T> extends Schema<T[]> {
  min(length: number, message?: string): ArraySchema<T>;
  max(length: number, message?: string): ArraySchema<T>;
}

export type InferSchema<T> = T extends Schema<infer U> ? U : never;

type Shape = Record<string, Schema<unknown>>;
type InferShape<T extends Shape> = {
  [K in keyof T as undefined extends InferSchema<T[K]> ? never : K]: InferSchema<T[K]>;
} & {
  [K in keyof T as undefined extends InferSchema<T[K]> ? K : never]?: Exclude<InferSchema<T[K]>, undefined>;
};

const err = (path: string, message: string): RuntimeError => ({
  code: "INVALID_INPUT",
  message,
  path,
});

const typeName = (value: unknown) => Array.isArray(value) ? "array" : value === null ? "null" : typeof value;

class BaseSchema<T> implements Schema<T> {
  constructor(
    private readonly parser: (value: unknown, path: string) => ParseResult<T>,
    private readonly json: () => JsonSchemaLike,
  ) {}

  parse(value: unknown, path = ""): ParseResult<T> {
    return this.parser(value, path);
  }

  toJSON(): JsonSchemaLike {
    return this.json();
  }

  optional(): Schema<T | undefined> {
    return optional(this);
  }

  nullable(): Schema<T | null> {
    return nullable(this);
  }

  describe(description: string): Schema<T> {
    return describe(this, description);
  }

  refine(predicate: (value: T) => boolean, message: string): Schema<T> {
    return refine(this, predicate, message);
  }
}

const schema = <T>(
  parser: (value: unknown, path: string) => ParseResult<T>,
  json: () => JsonSchemaLike,
): Schema<T> => new BaseSchema(parser, json);

const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value });
const fail = <T = never>(error: RuntimeError): ParseResult<T> => ({ ok: false, errors: [error] });

function optional<T>(inner: Schema<T>): Schema<T | undefined> {
  return schema(
    (value, path) => value === undefined ? ok(undefined) : inner.parse(value, path),
    () => ({ ...inner.toJSON(), optional: true }),
  );
}

function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return schema(
    (value, path) => value === null ? ok(null) : inner.parse(value, path),
    () => ({ ...inner.toJSON(), nullable: true }),
  );
}

function describe<T>(inner: Schema<T>, description: string): Schema<T> {
  return schema(
    (value, path) => inner.parse(value, path),
    () => ({ ...inner.toJSON(), description }),
  );
}

function refine<T>(inner: Schema<T>, predicate: (value: T) => boolean, message: string): Schema<T> {
  return schema(
    (value, path) => {
      const parsed = inner.parse(value, path);
      if (!parsed.ok) return parsed;
      return predicate(parsed.value) ? parsed : fail(err(path, message));
    },
    () => inner.toJSON(),
  );
}

function withStringMethods(inner: Schema<string>): StringSchema {
  return Object.assign(inner, {
    min: (length: number, message = `Expected string length >= ${length}`) => withStringMethods(schema(
      (value, path) => {
        const parsed = inner.parse(value, path);
        if (!parsed.ok) return parsed;
        return parsed.value.length >= length ? parsed : fail(err(path, message));
      },
      () => ({ ...inner.toJSON(), minLength: length }),
    )),
    max: (length: number, message = `Expected string length <= ${length}`) => withStringMethods(schema(
      (value, path) => {
        const parsed = inner.parse(value, path);
        if (!parsed.ok) return parsed;
        return parsed.value.length <= length ? parsed : fail(err(path, message));
      },
      () => ({ ...inner.toJSON(), maxLength: length }),
    )),
    regex: (pattern: RegExp, message = `Expected string to match ${pattern}`) => {
      const flags = pattern.flags.replace(/[gy]/g, "");
      return withStringMethods(schema(
        (value, path) => {
          const parsed = inner.parse(value, path);
          if (!parsed.ok) return parsed;
          return new RegExp(pattern.source, flags).test(parsed.value) ? parsed : fail(err(path, message));
        },
        () => ({ ...inner.toJSON(), pattern: pattern.source }),
      ));
    },
  });
}

function withNumberMethods(inner: Schema<number>): NumberSchema {
  return Object.assign(inner, {
    min: (value: number, message = `Expected number >= ${value}`) => withNumberMethods(schema(
      (input, path) => {
        const parsed = inner.parse(input, path);
        if (!parsed.ok) return parsed;
        return parsed.value >= value ? parsed : fail(err(path, message));
      },
      () => ({ ...inner.toJSON(), minimum: value }),
    )),
    max: (value: number, message = `Expected number <= ${value}`) => withNumberMethods(schema(
      (input, path) => {
        const parsed = inner.parse(input, path);
        if (!parsed.ok) return parsed;
        return parsed.value <= value ? parsed : fail(err(path, message));
      },
      () => ({ ...inner.toJSON(), maximum: value }),
    )),
  });
}

function withArrayMethods<T>(inner: Schema<T[]>): ArraySchema<T> {
  return Object.assign(inner, {
    min: (length: number, message = `Expected array length >= ${length}`) => withArrayMethods(schema(
      (value, path) => {
        const parsed = inner.parse(value, path);
        if (!parsed.ok) return parsed;
        return parsed.value.length >= length ? parsed : fail(err(path, message));
      },
      () => ({ ...inner.toJSON(), minItems: length }),
    )),
    max: (length: number, message = `Expected array length <= ${length}`) => withArrayMethods(schema(
      (value, path) => {
        const parsed = inner.parse(value, path);
        if (!parsed.ok) return parsed;
        return parsed.value.length <= length ? parsed : fail(err(path, message));
      },
      () => ({ ...inner.toJSON(), maxItems: length }),
    )),
  });
}

function isOptional(schema: Schema<unknown>): boolean {
  return schema.parse(undefined).ok;
}

export const s = {
  string: (): StringSchema => withStringMethods(schema(
    (value, path) => typeof value === "string" ? ok(value) : fail(err(path, `Expected string, got ${typeName(value)}`)),
    () => ({ type: "string" }),
  )),

  number: (): NumberSchema => withNumberMethods(schema(
    (value, path) => typeof value === "number" && Number.isFinite(value) ? ok(value) : fail(err(path, `Expected number, got ${typeName(value)}`)),
    () => ({ type: "number" }),
  )),

  int: (): NumberSchema => withNumberMethods(schema(
    (value, path) => typeof value === "number" && Number.isInteger(value) ? ok(value) : fail(err(path, `Expected integer, got ${typeName(value)}`)),
    () => ({ type: "integer" }),
  )),

  boolean: (): Schema<boolean> => schema(
    (value, path) => typeof value === "boolean" ? ok(value) : fail(err(path, `Expected boolean, got ${typeName(value)}`)),
    () => ({ type: "boolean" }),
  ),

  literal: <T extends string | number | boolean | null>(literal: T): Schema<T> => schema(
    (value, path) => Object.is(value, literal) ? ok(literal) : fail(err(path, `Expected literal ${JSON.stringify(literal)}`)),
    () => ({ const: literal }),
  ),

  enum: <const T extends readonly [string, ...string[]]>(values: T): Schema<T[number]> => schema(
    (value, path) => typeof value === "string" && (values as readonly string[]).includes(value)
      ? ok(value as T[number])
      : fail(err(path, `Expected one of: ${values.join(", ")}`)),
    () => ({ type: "string", enum: [...values] }),
  ),

  array: <T>(item: Schema<T>): ArraySchema<T> => withArrayMethods(schema(
    (value, path) => {
      if (!Array.isArray(value)) return fail(err(path, `Expected array, got ${typeName(value)}`));
      const out: T[] = [];
      const errors: RuntimeError[] = [];
      value.forEach((entry, index) => {
        const parsed = item.parse(entry, path ? `${path}.${index}` : String(index));
        if (parsed.ok) out.push(parsed.value);
        else errors.push(...parsed.errors);
      });
      return errors.length ? { ok: false, errors } : ok(out);
    },
    () => ({ type: "array", items: item.toJSON() }),
  )),

  object: <T extends Shape>(shape: T): Schema<InferShape<T>> => schema(
    (value, path) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return fail(err(path, `Expected object, got ${typeName(value)}`));
      }
      const input = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      const errors: RuntimeError[] = [];
      for (const key of Object.keys(input)) {
        if (!(key in shape)) {
          errors.push(err(path ? `${path}.${key}` : key, `Unexpected property: ${key}`));
        }
      }
      for (const [key, child] of Object.entries(shape)) {
        const childPath = path ? `${path}.${key}` : key;
        const parsed = child.parse(input[key], childPath);
        if (parsed.ok) {
          if (parsed.value !== undefined) out[key] = parsed.value;
        } else {
          errors.push(...parsed.errors);
        }
      }
      return errors.length ? { ok: false, errors } : ok(out as InferShape<T>);
    },
    () => {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = child.toJSON();
        if (!isOptional(child)) required.push(key);
      }
      return { type: "object", properties, required, additionalProperties: false };
    },
  ),

  optional,
  nullable,
  describe,
  refine,

  union: <const T extends readonly [Schema<unknown>, Schema<unknown>, ...Schema<unknown>[]]>(members: T): Schema<InferSchema<T[number]>> => schema(
    (value, path) => {
      const errors: RuntimeError[] = [];
      for (const member of members) {
        const parsed = member.parse(value, path);
        if (parsed.ok) return ok(parsed.value as InferSchema<T[number]>);
        errors.push(...parsed.errors);
      }
      return { ok: false, errors: [err(path, "Expected value matching one union member"), ...errors] };
    },
    () => ({ anyOf: members.map(member => member.toJSON()) }),
  ),

  discriminatedUnion: <K extends string, const T extends readonly [Schema<unknown>, Schema<unknown>, ...Schema<unknown>[]]>(key: K, members: T): Schema<InferSchema<T[number]>> => schema(
    (value, path) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return fail(err(path, `Expected object, got ${typeName(value)}`));
      const errors: RuntimeError[] = [];
      for (const member of members) {
        const parsed = member.parse(value, path);
        if (parsed.ok) return ok(parsed.value as InferSchema<T[number]>);
        errors.push(...parsed.errors.filter(error => error.path === (path ? `${path}.${key}` : key)));
      }
      return { ok: false, errors: errors.length ? errors : [err(path ? `${path}.${key}` : key, "Expected valid discriminator")] };
    },
    () => ({ oneOf: members.map(member => member.toJSON()), discriminator: { propertyName: key } }),
  ),

  record: <T>(valueSchema: Schema<T>): Schema<Record<string, T>> => schema(
    (value, path) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return fail(err(path, `Expected object record, got ${typeName(value)}`));
      }
      const out: Record<string, T> = {};
      const errors: RuntimeError[] = [];
      for (const [key, entry] of Object.entries(value)) {
        const parsed = valueSchema.parse(entry, path ? `${path}.${key}` : key);
        if (parsed.ok) out[key] = parsed.value;
        else errors.push(...parsed.errors);
      }
      return errors.length ? { ok: false, errors } : ok(out);
    },
    () => ({ type: "object", additionalProperties: valueSchema.toJSON() }),
  ),

  unknown: (): Schema<unknown> => schema(
    (value) => ok(value),
    () => ({}),
  ),
};
