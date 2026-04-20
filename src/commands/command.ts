import type { ActionDispatch } from "react";
import { type Action, type AppState } from "../store/store";
import { kubectl } from "./kubectl";
import { ping } from "./ping";
import { curl } from "./curl";
import { nslookup } from "./nslookup";
import { listFiles, readFile, writeFile } from "./helpers/filesystem";

/**
 * Splits a raw input line on the first unquoted `>`, returning the command
 * portion and an optional redirect target filename.
 */
function parseRedirect(input: string): { cmd: string; redirectTo: string | null } {
    let quote: "'" | '"' | null = null;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (quote) {
            if (ch === quote) quote = null;
        } else if (ch === "'" || ch === '"') {
            quote = ch;
        } else if (ch === ">") {
            const redirectTo = input.slice(i + 1).trim();
            return { cmd: input.slice(0, i).trim(), redirectTo: redirectTo || null };
        }
    }
    return { cmd: input, redirectTo: null };
}

// Splits a command line into tokens, honouring single and double quotes so
// that values containing spaces (e.g. --schedule='*/1 * * * *') are kept
// together as one token. Surrounding quotes are stripped from each token.
function tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let quote: "'" | '"' | null = null;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (quote) {
            if (ch === quote) {
                quote = null;
            } else {
                current += ch;
            }
        } else if (ch === "'" || ch === '"') {
            quote = ch;
        } else if (ch === " ") {
            if (current.length > 0) {
                tokens.push(current);
                current = "";
            }
        } else {
            current += ch;
        }
    }
    if (current.length > 0) tokens.push(current);
    return tokens;
}

async function* exec(
    command: string,
    args: string[],
    dispatch: ActionDispatch<[action: Action]>,
    getState: () => AppState,
    openEditor: (yaml: string, namespace: string) => void,
): AsyncGenerator<string> {
    if (command === "") {
        return;
    } else if (command === "help") {
        yield "Available commands: help, echo [message], date";
    } else if (command === "echo") {
        yield args.join(" ");
    } else if (command === "date") {
        if (args[0] === "--iso") {
            yield new Date().toISOString();
        } else {
            yield new Date().toString();
        }
    } else if (command === "ping") {
        yield* ping(args, getState());
    } else if (command === "ls") {
        const files = listFiles();
        if (files.length > 0) {
            for (const name of files) yield name;
        }
    } else if (command === "cat") {
        if (!args[0]) {
            yield "cat: missing filename";
        } else {
            const content = readFile(args[0]);
            if (content === undefined) {
                yield `cat: ${args[0]}: No such file`;
            } else {
                yield content;
            }
        }
    } else if (command === "curl") {
        yield curl(args, getState());
    } else if (command === "nslookup") {
        yield nslookup(args, getState());
    } else if (command === "kubectl") {
        yield* kubectl(args, dispatch, getState, openEditor);
    } else {
        yield `Unknown command: ${command}`;
    }
}

export async function* shell(
    inputLine: string,
    dispatch: ActionDispatch<[action: Action]>,
    getState: () => AppState,
    openEditor: (yaml: string, namespace: string) => void = () => { },
): AsyncGenerator<string> {
    const { cmd, redirectTo } = parseRedirect(inputLine.trim());
    const tokens = tokenize(cmd);
    // Lowercase only the command verb, not flag values (preserves cron schedules, images, etc.)
    const command = (tokens[0] ?? "").toLowerCase();
    const args = tokens.slice(1);

    if (redirectTo) {
        const lines: string[] = [];
        for await (const line of exec(command, args, dispatch, getState, openEditor)) {
            lines.push(line);
        }
        writeFile(redirectTo, lines.join("\n"));
        return;
    }

    yield* exec(command, args, dispatch, getState, openEditor);
}
