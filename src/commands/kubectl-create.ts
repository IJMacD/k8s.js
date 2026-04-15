import type { ActionDispatch } from "react";
import {
    createCronJob,
    createDaemonSet,
    createDeployment,
    createJob,
    createPod,
    createStatefulSet,
    type Action,
    type AppState,
} from "../store/store";

export async function* kubectlCreate(
    args: string[],
    namespace: string,
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
): AsyncGenerator<string> {
    if (args[0] === "run") {
        const name = args[1];

        if (args[2] === "--image") {
            const image = args[3];
            const restartFlag = args.find(a => a.startsWith("--restart="));
            const restartPolicy = restartFlag?.slice("--restart=".length) as "Always" | "OnFailure" | "Never" | undefined;
            const envArgs: string[] = [];
            for (let i = 0; i < args.length; i++) {
                if (args[i].startsWith("--env=")) envArgs.push(args[i].slice("--env=".length));
                else if (args[i] === "--env" && args[i + 1]) envArgs.push(args[++i]);
            }
            const env = envArgs.map(kv => {
                const eq = kv.indexOf("=");
                return eq < 0 ? { name: kv, value: "" } : { name: kv.slice(0, eq), value: kv.slice(eq + 1) };
            });
            if (state.Pods.some(p => p.metadata.name === name && p.metadata.namespace === namespace))
                throw Error(`Error from server (AlreadyExists): pods "${name}" already exists`);
            dispatch(createPod(name, { image, restartPolicy, ...(env.length && { env }) }, namespace));
            yield `pod/${name} created`; return;
        } else {
            throw Error("Expecting --image");
        }
    }
    if (args[0] === "create" && args[1] === "job") {
        const name = args[2];
        if (!name) throw Error("kubectl create job: missing NAME");

        // kubectl create job <name> --from=cronjob/<cron-name>
        const fromFlag = args.find(a => a.startsWith("--from="));
        if (fromFlag) {
            const ref = fromFlag.slice("--from=".length);
            if (!ref.startsWith("cronjob/")) throw Error("kubectl create job --from: only cronjob/<name> is supported");
            const cronName = ref.slice("cronjob/".length);
            const cj = state.CronJobs.find(
                c => c.metadata.name === cronName && c.metadata.namespace === namespace,
            );
            if (!cj) throw Error(`Error from server (NotFound): cronjobs "${cronName}" not found`);
            if (state.Jobs.some(j => j.metadata.name === name && j.metadata.namespace === namespace))
                throw Error(`Error from server (AlreadyExists): jobs "${name}" already exists`);
            const s = cj.spec.jobTemplate.spec;
            dispatch(createJob(name, {
                image: s.template.spec.containers[0]?.image ?? "",
                completions: s.completions,
                parallelism: s.parallelism,
                backoffLimit: s.backoffLimit,
            }, namespace, { kind: "CronJob", apiVersion: "batch/v1", name: cronName, uid: cj.metadata.uid }));
            yield `job.batch/${name} created`; return;
        }

        const imageFlag = args.find(a => a.startsWith("--image="));
        if (!imageFlag) throw Error("kubectl create job: --image=IMAGE is required (or use --from=cronjob/<name>)");
        const image = imageFlag.slice("--image=".length);

        const completions = parseInt(args.find(a => a.startsWith("--completions="))?.slice("--completions=".length) ?? "1", 10);
        const parallelism = parseInt(args.find(a => a.startsWith("--parallelism="))?.slice("--parallelism=".length) ?? "1", 10);
        const backoffLimit = parseInt(args.find(a => a.startsWith("--backoff-limit="))?.slice("--backoff-limit=".length) ?? "6", 10);

        if (state.Jobs.some(j => j.metadata.name === name && j.metadata.namespace === namespace))
            throw Error(`Error from server (AlreadyExists): jobs "${name}" already exists`);
        dispatch(createJob(name, { image, completions, parallelism, backoffLimit }, namespace));
        yield `job.batch/${name} created`; return;
    }
    if (args[0] === "create" && args[1] === "cronjob") {
        const name = args[2];
        if (!name) throw Error("kubectl create cronjob: missing NAME");

        const imageFlag = args.find(a => a.startsWith("--image="));
        if (!imageFlag) throw Error("kubectl create cronjob: --image=IMAGE is required");
        const image = imageFlag.slice("--image=".length);

        const scheduleFlag = args.find(a => a.startsWith("--schedule="));
        if (!scheduleFlag) throw Error("kubectl create cronjob: --schedule=CRON is required (e.g. --schedule='*/1 * * * *')");
        const schedule = scheduleFlag.slice("--schedule=".length);

        const completions = parseInt(args.find(a => a.startsWith("--completions="))?.slice("--completions=".length) ?? "1", 10);
        const parallelism = parseInt(args.find(a => a.startsWith("--parallelism="))?.slice("--parallelism=".length) ?? "1", 10);

        if (state.CronJobs.some(c => c.metadata.name === name && c.metadata.namespace === namespace))
            throw Error(`Error from server (AlreadyExists): cronjobs "${name}" already exists`);
        dispatch(createCronJob(name, { image, schedule, completions, parallelism }, namespace));
        yield `cronjob.batch/${name} created`; return;
    }
    if (args[0] === "create" && args[1] === "daemonset") {
        const name = args[2];
        if (!name) throw Error("kubectl create daemonset: missing NAME");

        const imageFlag = args.find(a => a.startsWith("--image="));
        if (!imageFlag) throw Error("kubectl create daemonset: --image=IMAGE is required");
        const image = imageFlag.slice("--image=".length);

        if (state.DaemonSets.some(ds => ds.metadata.name === name && ds.metadata.namespace === namespace))
            throw Error(`Error from server (AlreadyExists): daemonsets "${name}" already exists`);
        dispatch(createDaemonSet(name, { image }, namespace));
        yield `daemonset.apps/${name} created`; return;
    }
    if (args[0] === "create" && args[1] === "statefulset") {
        const name = args[2];
        if (!name) throw Error("kubectl create statefulset: missing NAME");

        const imageFlag = args.find(a => a.startsWith("--image="));
        if (!imageFlag) throw Error("kubectl create statefulset: --image=IMAGE is required");
        const image = imageFlag.slice("--image=".length);

        const replicasFlag = args.find(a => a.startsWith("--replicas="));
        const replicas = replicasFlag ? parseInt(replicasFlag.slice("--replicas=".length), 10) : 1;

        if (state.StatefulSets.some(sts => sts.metadata.name === name && sts.metadata.namespace === namespace))
            throw Error(`Error from server (AlreadyExists): statefulsets "${name}" already exists`);
        dispatch(createStatefulSet(name, { image, replicas }, namespace));
        yield `statefulset.apps/${name} created`; return;
    }
    if (args[0] === "create" && args[1] === "deployment") {
        const name = args[2];
        if (!name) throw Error("kubectl create deployment: missing NAME");

        const imageFlag = args.find(a => a.startsWith("--image="));
        if (!imageFlag) throw Error("kubectl create deployment: --image=IMAGE is required");
        const image = imageFlag.slice("--image=".length);

        const replicasFlag = args.find(a => a.startsWith("--replicas="));
        const replicas = replicasFlag ? parseInt(replicasFlag.slice("--replicas=".length), 10) : 1;

        if (state.Deployments.some(d => d.metadata.name === name && d.metadata.namespace === namespace))
            throw Error(`Error from server (AlreadyExists): deployments "${name}" already exists`);
        dispatch(createDeployment(name, { image, replicas }, namespace));
        yield `deployment.apps/${name} created`; return;
    }
    throw Error(`kubectl ${args[0]}: unknown subcommand "${args[1]}"`);
}
