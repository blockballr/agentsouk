export const EXIT = {
  ok: 0,
  failure: 1,
  usage: 2,
} as const;

export class CliError extends Error {
  readonly code: string;
  readonly exit: number;

  constructor(message: string, code = "error", exit: number = EXIT.failure) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exit = exit;
  }
}

export class ApiError extends CliError {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message, `http_${status}`, status === 400 ? EXIT.usage : EXIT.failure);
    this.name = "ApiError";
    this.status = status;
  }
}

// the one place a thrown error becomes an exit code and a stderr line
export function report(error: unknown, asJson: boolean): number {
  const cli =
    error instanceof CliError
      ? error
      : new CliError(error instanceof Error ? error.message : String(error));
  if (asJson) {
    process.stderr.write(`${JSON.stringify({ error: { code: cli.code, message: cli.message } })}\n`);
  } else {
    process.stderr.write(`error: ${cli.message}\n`);
  }
  return cli.exit;
}
