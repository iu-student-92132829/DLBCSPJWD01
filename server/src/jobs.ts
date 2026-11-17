import ffmpeg from '@modernized/fluent-ffmpeg';
import { getOutputTargetPath, getUploadDuration, getUploadPath, UUID } from './utils.js';
import EventEmitter from 'node:events';

export enum JobStage {
    Enqueued = 'enqueued',
    Processing = 'processing',
    Completed = 'completed',
    Failed = 'failed',
}

export interface JobData {
    ext: string;
    speed: number; // 1 = no speed change.
    reverse: boolean; // false = no reverse.
    mute: boolean; // false = no mute.
    stage: JobStage;
    processingProgress: number;
    queuePosition: number | undefined; // 0 = the current processing job.
    error: string | undefined;
}

let generation = 0; // Current generation that is running (allows tests to be ran without influencing each other).
let currentFfmpeg: ReturnType<typeof ffmpeg> | undefined;
const jobs = new Map<UUID, JobData>();
const jobEvents = new EventEmitter();
let processingJob: UUID | undefined;

/**
 * Clear all jobs, additionally kills ffmpeg and increments the generation counter.
 */
export function clearJobs() {
    generation++;
    currentFfmpeg?.kill();
    jobs.clear();
    processingJob = undefined;
}

/**
 * Emit a job to the job event listeners.
 */
function emitJob(id: UUID) {
    const job = jobs.get(id);
    if (job) jobEvents.emit(id, { ...job });
}

/**
 * Register a job event listeners.
 */
export function onJobEvent(id: UUID, listener: (jobData: JobData) => void) {
    jobEvents.on(id, listener);
}

/**
 * Unregister a job event listeners.
 */
export function offJobEvent(id: UUID, listener: (jobData: JobData) => void) {
    jobEvents.off(id, listener);
}

/**
 * Can mutate a job to the 'failed' state if its uploaded file is deleted during the 'enqueued'
 * or 'processing' stage.
 */
export function getJob(id: UUID): Readonly<JobData> | undefined {
    const job = jobs.get(id);
    if (job === undefined) return undefined;

    // Make sure the video file still exists when enqueued and/or processing.
    if (job.stage === JobStage.Enqueued || job.stage === JobStage.Processing) {
        const uploadPath = getUploadPath(id, job.ext);

        if (uploadPath === undefined) {
            job.stage = JobStage.Failed;
            job.error = 'Video was deleted during processing.';
            job.queuePosition = undefined;
            emitJob(id);
        }
    }

    return job;
}

/**
 * Adds a job to queue, if it is the only enqueued job it immediately started processing.
 */
export function addJob(id: UUID, ext: string, speed: number, reverse: boolean, mute: boolean) {
    const queueSize = [...jobs.values()].filter(v => (v.stage === JobStage.Enqueued)).length + 1;

    const jobData: JobData = {
        ext: ext,
        speed: speed,
        reverse: reverse,
        mute: mute,
        stage: processingJob === undefined ? JobStage.Processing : JobStage.Enqueued,
        processingProgress: 0.0,
        queuePosition: processingJob === undefined ? 0 : queueSize,
        error: undefined,
    };

    jobs.set(id, jobData);
    emitJob(id);

    if (processingJob === undefined) {
        processingJob = id;
        handleQueue();
    }
}

/**
 * Handles the queue job by job sequentially aborting if the generation changes.
 */
async function handleQueue() {
    const gen = generation;

    if (typeof processingJob === 'string') {
        processJob(processingJob).then(() => {
            if (gen !== generation) return;
            handleQueueInner();
        });
    }
}

async function handleQueueInner() {
    const gen = generation;

    if (typeof processingJob === 'string') {
        nextJob().then(() => {
            if (gen !== generation) return;
            if (processingJob === undefined) return;
            handleQueueInner();
        });
    }
}

/**
 * Processes a job by first checking if there's a job to process.
 * Then checks if there's a valid associated upload.
 * Then gets the duration of the upload, aborting if the generation has changed.
 * Then launches an ffmpeg process to process the video according to the job's parameters.
 */
async function processJob(id: UUID): Promise<void> {
    if (processingJob === undefined) {
        return new Promise<void>((resolve, _) => { resolve(); });
    }

    const job = jobs.get(id);

    return new Promise<void>(async (resolve, _) => {
        if (job !== undefined) {
            if (job.stage === JobStage.Failed) {
                resolve();
                return;
            }

            processingJob = id;

            const uploadPath = getUploadPath(id, job.ext);
            const outputPath = getOutputTargetPath(id, job.ext);

            if (uploadPath === undefined) {
                job.stage = JobStage.Failed;
                job.error = 'Video was deleted during processing.';
                job.queuePosition = undefined;
                emitJob(id);

                resolve();
                return;
            }


            const gen = generation;
            const inputDuration = await getUploadDuration(id, job.ext);
            const expectedOutDuration = (inputDuration !== undefined) ? (inputDuration / job.speed) : undefined;
            if (gen !== generation) return;

            const command = ffmpeg(uploadPath)
                .outputOptions(getFFmpegFilters(job))
                .on('progress', (p) => {
                    if (expectedOutDuration === undefined) return;

                    // Convert to seconds.
                    const [h, m, s] = String(p.timemark).split(':').map(Number);
                    const seconds = h * 3600 + m * 60 + s;
                    if (!Number.isFinite(seconds) || job.processingProgress === 1) return;

                    // Update the progress making sure it cannot be set to exactly 1.
                    let progress = seconds / expectedOutDuration;
                    if (progress >= 1) progress = 1 - Number.EPSILON;

                    job.processingProgress = progress;
                    emitJob(id);
                })
                .on('end', () => {
                    job.stage = JobStage.Completed;
                    job.processingProgress = 1.0;
                    job.queuePosition = undefined;
                    emitJob(id);

                    resolve();
                })
                .on('error', (_) => {
                    job.stage = JobStage.Failed;
                    job.error = `Video processing error.`;
                    job.queuePosition = undefined;
                    emitJob(id);

                    resolve();
                });

            currentFfmpeg = command;
            command.save(outputPath);
        }
    });
}

/**
 * Finds the next job to process, immediately processing it if it is valid.
 * Gaps may exist in the 'queuePosition' if uploaded files are deleted.
 */
async function nextJob() {
    processingJob = undefined;
    let enqueuedJobs = 0;

    do {
        for (const [key, value] of jobs.entries()) {
            // Make sure the job is actually enqueued.
            if (value.queuePosition === undefined) continue;
            if (value.queuePosition <= 0) {
                throw "Next job was attempted to be started during an active job.";
            }

            enqueuedJobs += 1;
            value.queuePosition -= 1;

            if (processingJob === undefined && value.queuePosition === 0) {
                processingJob = key;
                jobs.get(key)!!.stage = JobStage.Processing;
            }
        }

        // Loop only if any jobs are still queued and we haven't found a job to process yet.
    } while (processingJob === undefined && enqueuedJobs !== 0);

    if (typeof processingJob === "string") {
        return processJob(processingJob);
    }
}

// Build ffmpeg filters.

/**
 * Handles speeds below 0.5 by chaining multiple 'atempo' parameters.
 */
function handleAtempo(speed: number): string {
    // Work outside of the box.
    if (speed >= 0.5 && speed <= 100.0) {
        return `atempo=${speed}`;
    }

    // Chain atempo filters as ffmpeg does not allow values below '0.5'.

    let remaining = speed;
    const factors: string[] = [];

    while (remaining < 0.5) {
        factors.push('0.5');
        remaining /= 0.5;
    }

    if (remaining !== 1.0) {
        factors.push(remaining.toFixed(4));
    }

    return factors.map(f => `atempo=${f}`).join(',');
}

/**
 * Builds the ffmpeg filters.
 * 'mute' removes the entire audio stream to optimize file size.
 */
function getFFmpegFilters(job: JobData): string[] {
    const videoFilters: string[] = [];
    const audioFilters: string[] = [];

    // Handle reversing.
    if (job.reverse) {
        videoFilters.push('reverse');
        audioFilters.push('areverse');
    }

    // Handle changing the speed.
    if (job.speed !== 1) {
        videoFilters.push(`setpts=${1 / job.speed}*PTS`);
        audioFilters.push(handleAtempo(job.speed));
    }

    // Handle arguments
    const args: string[] = [];

    // Audio filters
    if (job.mute) {
        // Remove the audio stream.
        args.push('-an');
    } else {
        if (audioFilters.length > 0) {
            args.push('-af', audioFilters.join(','));
        }
    }

    // Video filters
    if (videoFilters.length > 0) {
        args.push('-vf', videoFilters.join(','));
    }

    return args;
}
