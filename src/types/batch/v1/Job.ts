import type { PodTemplateSpec } from "../../v1/Pod";
import type { OwnerReference } from "../../v1/ObjectMeta";

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

export interface Job {
    metadata: JobMetadata;
    spec: JobSpec;
    status: JobStatus;
}

export interface JobMetadata {
    uid: string;
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    ownerReferences?: OwnerReference[];
    creationTimestamp: string;
}

export interface JobSpec {
    completions: number;
    parallelism: number;
    backoffLimit: number;
    template: PodTemplateSpec;
}

export interface JobStatus {
    active: number;
    succeeded: number;
    failed: number;
    startTime?: string;
    completionTime?: string;
    conditions: JobCondition[];
}

export interface JobCondition {
    type: "Complete" | "Failed";
    status: "True" | "False";
    lastTransitionTime: string;
    reason?: string;
    message?: string;
}

// ---------------------------------------------------------------------------
// CronJob
// ---------------------------------------------------------------------------

export interface CronJob {
    metadata: CronJobMetadata;
    spec: CronJobSpec;
    status: CronJobStatus;
}

export interface CronJobMetadata {
    uid: string;
    name: string;
    namespace: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    creationTimestamp: string;
}

export interface CronJobSpec {
    schedule: string;
    suspend?: boolean;
    concurrencyPolicy?: "Allow" | "Forbid" | "Replace";
    successfulJobsHistoryLimit?: number;
    failedJobsHistoryLimit?: number;
    jobTemplate: {
        spec: {
            completions: number;
            parallelism: number;
            backoffLimit: number;
            template: PodTemplateSpec;
        };
    };
}

export interface CronJobStatus {
    lastScheduleTime?: string;
    active: Array<{ name: string; namespace: string }>;
}
