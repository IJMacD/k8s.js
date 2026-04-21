/** Pseudo filesystem: a persistent in-memory store of named files, backed by localStorage. */
const FS_KEY = "k8sjs:filesystem";

function load(): Map<string, string> {
    try {
        const raw = localStorage.getItem(FS_KEY);
        if (raw) {
            const obj = JSON.parse(raw) as Record<string, string>;
            return new Map(Object.entries(obj));
        }
    } catch {
        // corrupted storage — start fresh
    }
    return new Map();
}

function persist(map: Map<string, string>): void {
    try {
        localStorage.setItem(FS_KEY, JSON.stringify(Object.fromEntries(map)));
    } catch {
        // storage quota exceeded — proceed without persisting
    }
}

const fs = load();

/** Write (or overwrite) a file. */
export function writeFile(filename: string, content: string): void {
    fs.set(filename, content);
    persist(fs);
}

/** Read a file's content, or undefined if it does not exist. */
export function readFile(filename: string): string | undefined {
    return fs.get(filename);
}

/** List all filenames currently in the filesystem. */
export function listFiles(): string[] {
    return Array.from(fs.keys());
}

/** Delete a file. Returns true if the file existed, false otherwise. */
export function deleteFile(filename: string): boolean {
    const existed = fs.delete(filename);
    if (existed) persist(fs);
    return existed;
}
