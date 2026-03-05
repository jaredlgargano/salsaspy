export interface LogEntry {
    level: "info" | "warn" | "error";
    message: string;
    context?: Record<string, any>;
    timestamp: string;
}

export class Logger {
    private runId?: string;

    constructor(runId?: string) {
        this.runId = runId;
    }

    private log(level: LogEntry["level"], message: string, context?: Record<string, any>) {
        const entry: LogEntry = {
            level,
            message,
            context: { ...context, runId: this.runId },
            timestamp: new Date().toISOString()
        };

        // In Cloudflare Workers, console.log is captured by standard logging
        if (level === "error") {
            console.error(JSON.stringify(entry));
        } else if (level === "warn") {
            console.warn(JSON.stringify(entry));
        } else {
            console.log(JSON.stringify(entry));
        }
    }

    info(message: string, context?: Record<string, any>) {
        this.log("info", message, context);
    }

    warn(message: string, context?: Record<string, any>) {
        this.log("warn", message, context);
    }

    error(message: string, context?: Record<string, any>) {
        this.log("error", message, context);
    }
}

export const logger = new Logger();
