import { useEffect, useRef } from "react";
import type { ActionDispatch } from "react";
import type { AppState, Action } from "../store/store";
import { updatePodStatus } from "../store/store";

/**
 * Simulates the Kubernetes kubelet.
 * Watches Pods and drives each one through its lifecycle:
 *
 *   Pending (no conditions)
 *     → +1.0s   PodScheduled=True
 *                [if initContainers: initContainerStatuses initialised as Waiting]
 *     → +1.0s + k*2.0s  initContainer[k] terminates (each takes 2 s, sequential)
 *     → +1.0s + N*2.0s  Initialized=True  (N = initContainers count; min 1 s gap)
 *                        containerStatuses all set to Waiting:ContainerCreating
 *     → +Initialized + 1.5s + i*1.0s  container[i] transitions to Running+Ready
 *     → last container ready: ContainersReady=True, Ready=True, phase=Running
 *     [batch only → +2.0s after Running: phase=Succeeded, containers Terminated]
 */
export function useKubelet(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    const scheduledRef = useRef<Set<string>>(new Set());
    const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    const { Pods, Nodes } = state;

    useEffect(() => {
        for (const pod of Pods) {
            const uid = pod.metadata.uid;

            // Only drive Pending pods that have been bound to a node
            if (pod.status.phase !== "Pending") continue;
            if (!pod.spec.nodeName) continue;

            const conditions = pod.status.conditions ?? [];
            const hasScheduled       = conditions.some(c => c.type === "PodScheduled"    && c.status === "True");
            const hasInitialized     = conditions.some(c => c.type === "Initialized"     && c.status === "True");
            const hasContainersReady = conditions.some(c => c.type === "ContainersReady" && c.status === "True");

            // Fully transitioned — nothing to do
            if (hasContainersReady) continue;

            // Secondary guard: don't schedule the same pod's timers more than once per mount
            if (scheduledRef.current.has(uid)) continue;
            scheduledRef.current.add(uid);

            const { name, namespace } = pod.metadata;
            const now = () => new Date().toISOString();

            const initContainers = pod.spec.initContainers ?? [];
            const appContainers  = pod.spec.containers;
            const N = initContainers.length;
            const M = appContainers.length;
            const isBatch = pod.spec.restartPolicy === "OnFailure" || pod.spec.restartPolicy === "Never";

            const node = Nodes.find(n => n.metadata.name === pod.spec.nodeName);

            // How many init containers have already completed?
            const doneInitCount = (pod.status.initContainerStatuses ?? [])
                .filter(s => s.state?.terminated !== undefined).length;
            const remainingInit = N - doneInitCount;

            // How many app containers are already ready?
            const readyContainerCount = (pod.status.containerStatuses ?? [])
                .filter(s => s.ready).length;
            const remainingApp = M - readyContainerCount;

            // ── Base delays from "now" (time this effect runs) ──────────────
            const scheduledDelay   = hasScheduled ? 0 : 1_000;
            // Initialized fires: scheduledDelay + max(1 s, remainingInit * 2 s)
            const initGap          = Math.max(1_000, remainingInit * 2_000);
            const initializedDelay = hasInitialized ? 0 : scheduledDelay + initGap;

            // ── PodScheduled ─────────────────────────────────────────────────
            if (!hasScheduled) {
                timersRef.current.push(setTimeout(() => {
                    dispatch(updatePodStatus(name, namespace, {
                        conditions: [
                            { type: "PodScheduled", status: "True", lastTransitionTime: now() },
                        ],
                        // Prime initContainerStatuses so STATUS column shows Init:0/N straight away
                        ...(N > 0 ? {
                            initContainerStatuses: initContainers.map((ic, idx) => ({
                                name: ic.name,
                                ready: false,
                                started: idx === 0,
                                restartCount: 0,
                                state: idx === 0
                                    ? { waiting: { reason: `Init:0/${N}` } }
                                    : { waiting: { reason: "PodInitializing" } },
                            })),
                        } : {}),
                    }));
                }, scheduledDelay));
            }

            // ── initContainer completions + Initialized ──────────────────────
            if (!hasInitialized) {
                if (N === 0) {
                    // No init containers — just fire Initialized shortly after PodScheduled
                    timersRef.current.push(setTimeout(() => {
                        const t = now();
                        dispatch(updatePodStatus(name, namespace, {
                            conditions: [
                                { type: "PodScheduled", status: "True", lastTransitionTime: t },
                                { type: "Initialized",  status: "True", lastTransitionTime: t },
                            ],
                            containerStatuses: appContainers.map(c => ({
                                name: c.name,
                                ready: false,
                                started: false,
                                restartCount: 0,
                                state: { waiting: { reason: "ContainerCreating" } },
                            })),
                        }));
                    }, initializedDelay));
                } else {
                    // For each remaining init container, fire two timers:
                    //   +500ms into its slot → running (so visitors see it go green briefly)
                    //   at the end of its slot → terminated, next one waiting
                    for (let j = 0; j < remainingInit; j++) {
                        const realIndex     = doneInitCount + j;
                        const slotStart     = scheduledDelay + j * 2_000;
                        const isLast        = j === remainingInit - 1;
                        const doneAfterThis = realIndex + 1;

                        // Running state: 500ms into this init container's slot
                        timersRef.current.push(setTimeout(() => {
                            dispatch(updatePodStatus(name, namespace, {
                                initContainerStatuses: initContainers.map((ic, idx) => ({
                                    name: ic.name,
                                    ready: false,
                                    started: idx <= realIndex,
                                    restartCount: 0,
                                    state: idx < realIndex
                                        ? { terminated: { exitCode: 0 } }
                                        : idx === realIndex
                                        ? { running: { startedAt: now() } }
                                        : { waiting: { reason: "PodInitializing" } },
                                })),
                            }));
                        }, slotStart + 500));

                        // Termination: only needed for non-last ones;
                        // the last one is handled by the Initialized=True timer below
                        if (!isLast) {
                            timersRef.current.push(setTimeout(() => {
                                dispatch(updatePodStatus(name, namespace, {
                                    initContainerStatuses: initContainers.map((ic, idx) => ({
                                        name: ic.name,
                                        ready: idx < doneAfterThis,
                                        started: idx <= doneAfterThis,
                                        restartCount: 0,
                                        state: idx < doneAfterThis
                                            ? { terminated: { exitCode: 0 } }
                                            : idx === doneAfterThis
                                            ? { waiting: { reason: `Init:${doneAfterThis}/${N}` } }
                                            : { waiting: { reason: "PodInitializing" } },
                                    })),
                                }));
                            }, scheduledDelay + (j + 1) * 2_000));
                        }
                    }

                    // Last remaining init container terminates → fire Initialized=True
                    timersRef.current.push(setTimeout(() => {
                        const t = now();
                        dispatch(updatePodStatus(name, namespace, {
                            conditions: [
                                { type: "PodScheduled", status: "True", lastTransitionTime: t },
                                { type: "Initialized",  status: "True", lastTransitionTime: t },
                            ],
                            initContainerStatuses: initContainers.map(ic => ({
                                name: ic.name,
                                ready: true,
                                started: true,
                                restartCount: 0,
                                state: { terminated: { exitCode: 0 } },
                            })),
                            containerStatuses: appContainers.map(c => ({
                                name: c.name,
                                ready: false,
                                started: false,
                                restartCount: 0,
                                state: { waiting: { reason: "ContainerCreating" } },
                            })),
                        }));
                    }, initializedDelay));
                }
            }

            // ── Per-container Running transitions ────────────────────────────
            // Each container gets TWO timers:
            //   runningAt  → container is Running but NOT yet ready (shows orange in UI)
            //   readyAt    → container becomes Ready (shows green)
            // The gap between them is at least MIN_RUNNING_BEFORE_READY so orange is always visible.
            const MIN_RUNNING_BEFORE_READY = 1_000;

            for (let j = 0; j < remainingApp; j++) {
                const containerIndex  = readyContainerCount + j;
                const isLastContainer = containerIndex === M - 1;
                const container       = appContainers[containerIndex];
                const probeDelay      = (
                    (container.startupProbe?.initialDelaySeconds ?? 0) +
                    (container.readinessProbe?.initialDelaySeconds ?? 0)
                ) * 1_000;
                const runningAt = initializedDelay + 1_500 + j * 1_000;
                const readyAt   = runningAt + Math.max(probeDelay, MIN_RUNNING_BEFORE_READY);

                // Timer 1: container starts Running but is not yet ready → orange square.
                // When the first app container starts, also promote phase→Running and assign the pod IP.
                // (Real k8s: phase=Running as soon as any container is running; IP assigned at pod setup time.)
                timersRef.current.push(setTimeout(() => {
                    const t = now();
                    const isFirstContainer = containerIndex === 0;
                    const podIP  = isFirstContainer
                        ? (node?.spec.podCIDR
                            ? podIPFromCIDR(node.spec.podCIDR)
                            : `10.${rand(0, 255)}.${rand(0, 255)}.${rand(2, 254)}`)
                        : undefined;
                    const hostIP = isFirstContainer
                        ? node?.status.addresses.find(a => a.type === "InternalIP")?.address
                        : undefined;
                    dispatch(updatePodStatus(name, namespace, {
                        ...(isFirstContainer && {
                            phase:     "Running",
                            startTime: t,
                            podIP,
                            ...(hostIP && { hostIP }),
                            conditions: [
                                { type: "PodScheduled",    status: "True",  lastTransitionTime: t },
                                { type: "Initialized",     status: "True",  lastTransitionTime: t },
                                { type: "ContainersReady", status: "False", lastTransitionTime: t },
                                { type: "Ready",           status: "False", lastTransitionTime: t },
                            ],
                        }),
                        containerStatuses: appContainers.map((c, idx) => ({
                            name: c.name,
                            // Containers before this one are already Ready; this one is not.
                            ready:        idx < containerIndex,
                            started:      idx <= containerIndex,
                            restartCount: 0,
                            state: idx <= containerIndex
                                ? { running: { startedAt: t } }
                                : { waiting: { reason: "ContainerCreating" } },
                        })),
                    }));
                }, runningAt));

                timersRef.current.push(setTimeout(() => {
                    const t = now();

                    // All containers 0..containerIndex become Running+ready;
                    // containers above remain Waiting:ContainerCreating
                    const newContainerStatuses = appContainers.map((c, idx) => ({
                        name: c.name,
                        ready:        idx <= containerIndex,
                        started:      idx <= containerIndex,
                        restartCount: 0,
                        state: idx <= containerIndex
                            ? { running: { startedAt: t } }
                            : { waiting: { reason: "ContainerCreating" } },
                    }));

                    if (isLastContainer) {
                        const podIP  = node?.spec.podCIDR
                            ? podIPFromCIDR(node.spec.podCIDR)
                            : `10.${rand(0, 255)}.${rand(0, 255)}.${rand(2, 254)}`;
                        const hostIP = node?.status.addresses.find(a => a.type === "InternalIP")?.address;

                        dispatch(updatePodStatus(name, namespace, {
                            phase:     "Running",
                            startTime: t,
                            podIP,
                            ...(hostIP && { hostIP }),
                            conditions: [
                                { type: "PodScheduled",    status: "True", lastTransitionTime: t },
                                { type: "Initialized",     status: "True", lastTransitionTime: t },
                                { type: "ContainersReady", status: "True", lastTransitionTime: t },
                                { type: "Ready",           status: "True", lastTransitionTime: t },
                            ],
                            containerStatuses: newContainerStatuses,
                        }));

                        // Batch pods complete ~2 s after reaching Running.
                        // With BATCH_FAILURE_PROBABILITY one random container exits non-zero.
                        if (isBatch) {
                            timersRef.current.push(setTimeout(() => {
                                const completionTime = now();
                                const failIdx = Math.random() < BATCH_FAILURE_PROBABILITY
                                    ? rand(0, appContainers.length - 1)
                                    : -1;
                                const podFailed = failIdx >= 0;
                                dispatch(updatePodStatus(name, namespace, {
                                    phase: podFailed ? "Failed" : "Succeeded",
                                    conditions: [
                                        { type: "PodScheduled",    status: "True",  lastTransitionTime: t },
                                        { type: "Initialized",     status: "True",  lastTransitionTime: t },
                                        { type: "ContainersReady", status: "False", lastTransitionTime: completionTime },
                                        { type: "Ready",           status: "False", lastTransitionTime: completionTime },
                                    ],
                                    containerStatuses: appContainers.map((c, idx) => ({
                                        name: c.name,
                                        ready:        false,
                                        started:      false,
                                        restartCount: 0,
                                        state: {
                                            terminated: idx === failIdx
                                                ? { exitCode: 1, reason: "Error" }
                                                : { exitCode: 0, reason: "Completed" },
                                        },
                                    })),
                                }));
                            }, 2_000));
                        }
                    } else {
                        // Not the last container — update statuses only, no phase change
                        dispatch(updatePodStatus(name, namespace, {
                            containerStatuses: newContainerStatuses,
                        }));
                    }
                }, readyAt));
            }
        }
    }, [Pods, Nodes, dispatch]);

    // Clear timers and reset tracking on unmount.
    // scheduledRef must also be cleared so React Strict Mode's simulated
    // unmount/remount cycle doesn't strand partially-started pods.
    useEffect(() => {
        const timers    = timersRef.current;
        const scheduled = scheduledRef.current;
        return () => {
            timers.forEach(clearTimeout);
            scheduled.clear();
        };
    }, []);
}

/** Probability that a batch pod container exits with a non-zero code. */
const BATCH_FAILURE_PROBABILITY = 0.1;

function rand(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Pick a random host address within a /24 CIDR block (e.g. "10.244.1.0/24" → "10.244.1.x") */
function podIPFromCIDR(cidr: string): string {
    const base  = cidr.split("/")[0];
    const parts = base.split(".");
    parts[3]    = String(rand(2, 254));
    return parts.join(".");
}

