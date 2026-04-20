/** Pseudo filesystem: a persistent in-memory store of named files. */
const fs = new Map<string, string>();

/** Write (or overwrite) a file. */
export function writeFile(filename: string, content: string): void {
    fs.set(filename, content);
}

/** Read a file's content, or undefined if it does not exist. */
export function readFile(filename: string): string | undefined {
    return fs.get(filename);
}

/** List all filenames currently in the filesystem. */
export function listFiles(): string[] {
    return Array.from(fs.keys());
}
