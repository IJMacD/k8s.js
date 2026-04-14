import type { ActionDispatch } from "react";
import { createPod, type Action } from "./store";

export function command(
    inputLine: string,
    dispatch: ActionDispatch<[action: Action]>,
): Promise<string> {
    return new Promise((resolve) => {
        const [command, ...args] = inputLine.trim().toLowerCase().split(" ");

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
        } else if (command === "kubectl") {
            resolve(kubectl(args, dispatch));
        } else {
            resolve(`Unknown command: ${command}`);
            return;
        }
    });
}

function kubectl(
    args: string[],
    dispatch: ActionDispatch<[action: Action]>,
): Promise<string> {
    if (args[0] === "run") {
        const name = args[1];

        if (args[2] === "--image") {
            dispatch(createPod(name, { image: args[3] }));
            return Promise.resolve("");
        } else {
            throw Error("Expecting --image");
        }
    }
    throw Error(`kubectl: Unknown subcommand ${args[0]}`);
}
