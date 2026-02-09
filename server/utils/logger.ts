export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  [key: string]: unknown;
}

export class Logger {
  constructor(
    private prefix: string,
    private context: LogContext = {},
  ) {}

  debug(message: string, context?: LogContext) {
    this.log("debug", message, context);
  }

  info(message: string, context?: LogContext) {
    this.log("info", message, context);
  }

  warn(message: string, context?: LogContext) {
    this.log("warn", message, context);
  }

  error(message: string, error?: Error, context?: LogContext) {
    const errorContext = error
      ? {
          error: error.message,
          stack: error.stack,
          ...context,
        }
      : context;
    this.log("error", message, errorContext);
  }

  private log(level: LogLevel, message: string, context?: LogContext) {
    const fullContext = { ...this.context, ...context };
    const contextStr =
      Object.keys(fullContext).length > 0
        ? ` ${JSON.stringify(fullContext)}`
        : "";

    const formattedMessage = `[${this.prefix}] ${message}${contextStr}`;

    switch (level) {
      case "debug":
        console.debug(formattedMessage);
        break;
      case "info":
        console.log(formattedMessage);
        break;
      case "warn":
        console.warn(formattedMessage);
        break;
      case "error":
        console.error(formattedMessage);
        break;
    }
  }
}

export function createLogger(prefix: string, context?: LogContext): Logger {
  return new Logger(prefix, context);
}

export const loggers = {
  hubspot: createLogger("HubSpot"),
  gong: createLogger("Gong"),
  fireflies: createLogger("Fireflies"),
  monday: createLogger("Monday"),
  asana: createLogger("Asana"),
  googleDrive: createLogger("Google Drive"),
  sync: createLogger("Sync"),
  orchestrator: createLogger("Orchestrator"),
};
