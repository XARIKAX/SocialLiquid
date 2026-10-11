import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function err(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

/** wrap a route handler: zod + HttpError -> json error responses */
export function handler<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try {
      return await fn(...a);
    } catch (e) {
      if (e instanceof HttpError) return err(e.status, e.message);
      if (e instanceof ZodError) return err(400, e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      console.error(e);
      return err(500, (e as Error).message ?? "internal error");
    }
  };
}

export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "invalid json");
  }
  return schema.parse(raw);
}

/** JSON.stringify-safe conversion of prisma Decimal / BigInt / Date rows */
export function plain<T>(v: T): T {
  return JSON.parse(
    JSON.stringify(v, (_k, x) => {
      if (typeof x === "bigint") return Number(x);
      if (x && typeof x === "object" && "toFixed" in x && typeof (x as { toFixed: unknown }).toFixed === "function" && "d" in x) return Number(x);
      return x;
    }),
  ) as T;
}
