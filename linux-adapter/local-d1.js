import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

class LocalD1Prepared {
    constructor(statement, placeholderOrder = []) {
        this.statement = statement;
        this.placeholderOrder = placeholderOrder;
        this.args = [];
    }

    bind(...args) {
        this.args = args;
        return this;
    }

    getRunArgs() {
        if (!this.placeholderOrder.length) return this.args;
        return this.placeholderOrder.map((index) => this.args[index - 1]);
    }

    async run() {
        const result = this.statement.run(...this.getRunArgs());
        return {
            success: true,
            meta: {
                changes: result.changes,
                last_row_id: result.lastInsertRowid ? Number(result.lastInsertRowid) : 0
            }
        };
    }

    async all() {
        return {
            success: true,
            results: this.statement.all(...this.getRunArgs())
        };
    }

    async first() {
        return this.statement.get(...this.getRunArgs()) || null;
    }
}

export class LocalD1Database {
    constructor(dbPath) {
        const full = path.resolve(dbPath);
        mkdirSync(path.dirname(full), { recursive: true });
        this.db = new Database(full);
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("foreign_keys = ON");
    }

    prepare(sql) {
        const placeholderOrder = [];
        const normalizedSql = String(sql).replace(/\?(\d+)/g, (_, index) => {
            placeholderOrder.push(Number(index));
            return "?";
        });
        return new LocalD1Prepared(this.db.prepare(normalizedSql), placeholderOrder);
    }

    async batch(preparedStatements) {
        const runBatch = this.db.transaction((stmts) => {
            const results = [];
            for (const stmt of stmts) {
                const result = stmt.statement.run(...stmt.getRunArgs());
                results.push({
                    success: true,
                    meta: {
                        changes: result.changes,
                        last_row_id: result.lastInsertRowid ? Number(result.lastInsertRowid) : 0
                    }
                });
            }
            return results;
        });
        return runBatch(preparedStatements || []);
    }
}
