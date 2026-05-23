import { Database } from "bun:sqlite";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { env } from "../config/env";

const path = resolve(process.cwd(), env.DB_PATH);
mkdirSync(dirname(path), { recursive: true });

export const db = new Database(path, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec("PRAGMA foreign_keys = ON;");
