export interface Io {
  cwd: string;
  out(text: string): void;
  err(text: string): void;
}

export const processIo: Io = {
  cwd: process.cwd(),
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};
