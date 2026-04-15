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

export function command(
    inputLine: string,
    dispatch: ActionDispatch<[action: Action]>,
    state: AppState,
): Promise<string> {
    return new Promise((resolve) => {
        const tokens = tokenize(inputLine.trim());
        // Lowercase only the command verb, not flag values (preserves cron schedules, images, etc.)
        const command = (tokens[0] ?? "").toLowerCase();
        const args = tokens.slice(1);

        if (command === "") {
            resolve("");
            return;
        } else if (command === "help") {
            resolve("Available commands: help, echo [message], date");
            return;
        } else if (command === "echo") {
            const message = args.join(" ");
            resolve(message);
            return;
        } else if (command === "date") {
            if (args[0] === "--iso") {
                resolve(new Date().toISOString());
                return;
            }
            resolve(new Date().toString());
            return;
        } else if (command === "ping") {
            resolve(ping(args, state));
        } else if (command === "curl") {
            resolve(curl(args, state));
        } else if (command === "kubectl") {
            resolve(kubectl(args, dispatch, state));
        } else {
            resolve(`Unknown command: ${command}`);
            return;
        }
    });
}
