import type { ActionDispatch } from "react";
import { type Action, type AppState } from "../store/store";
import { kubectl } from "./kubectl";
import { ping } from "./ping";
import { curl } from "./curl";

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

export async function* command(
    inputLine: string,
    dispatch: ActionDispatch<[action: Action]>,
    getState: () => AppState,
): AsyncGenerator<string> {
    const tokens = tokenize(inputLine.trim());
    // Lowercase only the command verb, not flag values (preserves cron schedules, images, etc.)
    const command = (tokens[0] ?? "").toLowerCase();
    const args = tokens.slice(1);

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
    } else if (command === "curl") {
        yield curl(args, getState());
    } else if (command === "kubectl") {
        yield* kubectl(args, dispatch, getState);
    } else {
        yield `Unknown command: ${command}`;
    }
}
