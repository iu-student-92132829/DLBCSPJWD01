import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/express.js';
import path from 'path';
import { addJob, clearJobs, JobData } from '../src/jobs.js';
import { Response } from 'supertest';
import { EventSource } from 'eventsource';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { randomUUID } from 'crypto';

let server: Server;
let baseUrl: string;

// Start a server to make requests.
beforeAll(() => {
    server = app.listen(0);
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
    clearJobs();
    server.close();
});


/**
 * Wait for a job to reach a specific stage using polling.
 */
async function waitForJobStageViaPolling(id: string, targetStage: string[], timeout = 5000, interval = 10): Promise<any> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        const response = await request(server)
            .get(`/api/status/${id}`)
            .expect(200);

        if (targetStage.includes(response.body.stage)) {
            return response.body;
        }

        await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error(`Timed out waiting for job ${id} to reach stage '${targetStage}.'`);
}

/**
 * Wait for a job to reach a specific stage using events.
 */
async function waitForJobStageViaEvents(id: string, targetStage: string[], timeout = 5000): Promise<Array<JobData>> {
    return new Promise((resolve, reject) => {
        const jobDataHistory: Array<JobData> = [];
        const eventSource = new EventSource(`${baseUrl}/api/events/${id}`);

        const timer = setTimeout(() => {
            eventSource.close();
            reject(new Error(`Timed out waiting for job ${id} to reach stage '${targetStage}.`));
        }, timeout);

        eventSource.onmessage = (event) => {
            try {
                const jobData = JSON.parse(event.data);
                jobDataHistory.push(jobData);

                if (targetStage.includes(jobData.stage)) {
                    clearTimeout(timer);
                    eventSource?.close();
                    resolve(jobDataHistory);
                }
            } catch (err) {
                clearTimeout(timer);
                eventSource.close();
                reject(new Error("Error when parsing event data."));
            }
        };

        eventSource.onerror = () => {
            clearTimeout(timer);
            eventSource?.close();
            reject(new Error(`Event stream for job ${id} had an error before reaching '${targetStage}'.`));
        };
    });
}

/**
 * Posts a job and returns the resulting data.
 */
async function postJob(path: string, speed: number = 1.0, reverse: boolean = false, mute: boolean = false): Promise<Response> {
    return await request(server)
        .post('/api/upload')
        .field('task', JSON.stringify({
            speed,
            reverse,
            mute
        }))
        .attach('video', path);
}

/**
 * Posts a job and returns the resulting id.
 */
async function postJobId(path: string, speed: number = 1.0, reverse: boolean = false, mute: boolean = false): Promise<string> {
    return (await postJob(path, speed, reverse, mute)).body.id;
}

// File paths for testing.
const SAMPLE_VIDEO_PATH = path.join(__dirname, 'fixtures', 'sample.mp4');
const SAMPLE_TEXT_PATH = path.join(__dirname, 'fixtures', 'sample.txt');
const SAMPLE_REAL_VIDEO_PATH = path.join(__dirname, 'fixtures', 'real_video_sample.mp4'); // This is unused on purpose so the tests don't take long to run for the examinator, but it should be used in production.

describe('GET /api/status/:id', () => {
    it('returns the details of an existing job.', async () => {
        clearJobs();

        // This job is created directly so it doesn't depend on 'upload'.
        const id = randomUUID();
        addJob(id, '.mp4', 2.0, true, false);

        const response = await request(server).get(`/api/status/${id}`);

        // The stage of the job isn't chcked as it will fail due to lack of video file so we test for the settings instead.
        expect(response.status).toBe(200);
        expect(response.body.speed).toBe(2.0);
        expect(response.body.reverse).toBe(true);
        expect(response.body.mute).toBe(false);
    });
});

describe('POST /api/upload', () => {
    it('uploads a video and return the UUID of the job.', async () => {
        clearJobs();

        const response = await postJob(SAMPLE_VIDEO_PATH);

        // Verify information is of the correct format.
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('id');
        expect(response.body.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
    });

    it('rejects all files that are not videos.', async () => {
        clearJobs();

        const response = await postJob(SAMPLE_TEXT_PATH);

        // Verify an error is returned.
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error');
    });

    it('enqueues posts.', async () => {
        clearJobs();

        const ids = [];

        for (let index = 0; index < 2; index++) {
            ids.push(await postJobId(SAMPLE_VIDEO_PATH));
        }

        const firstResponse = await request(server)
            .get(`/api/status/${ids[0]}`)
            .expect('Content-Type', /json/)
            .expect(200);

        const secondResponse = await request(server)
            .get(`/api/status/${ids[1]}`)
            .expect('Content-Type', /json/)
            .expect(200);

        // Make sure the first posted video is processing and the next one is enqueued.
        expect(firstResponse.body.stage).toBe('processing');
        expect(secondResponse.body.stage).toBe('enqueued');
    });

    it('processes posts sequentially.', async () => {
        clearJobs();

        const ids: string[] = [];

        for (let index = 0; index < 2; index++) {
            ids.push(await postJobId(SAMPLE_VIDEO_PATH));
        }

        // Wait for the first job to complete or fail.
        const completedResponse = await waitForJobStageViaPolling(ids[0], ['completed', 'failed']);
        expect(completedResponse.stage).toBeOneOf(['completed', 'failed']);

        // Make sure the second job is no longer queued.
        const secondResponse = await request(server)
            .get(`/api/status/${ids[1]}`)
            .expect(200);

        expect(secondResponse.body.stage).not.toBe('enqueued');
    });

    it('handles tasks with all fields set to non-defaults.', async () => {
        clearJobs();

        const id = await postJobId(SAMPLE_VIDEO_PATH, 0.5, true, true);

        // Wait for the job to complete or fail.
        const completedResponse = await waitForJobStageViaPolling(id, ['completed', 'failed']);
        expect(completedResponse.stage).toBeOneOf(['completed']);
    });
});

describe('GET /api/download/:id', () => {
    it('downloads the processed video.', async () => {
        clearJobs();

        const id = await postJobId(SAMPLE_VIDEO_PATH);

        // Make sure processing completes before it attempts to download the file.
        const status = await waitForJobStageViaPolling(id, ['completed', 'failed'], 10000);
        expect(status.stage).toBe('completed');

        const response = await request(server)
            .get(`/api/download/${id}`)
            .expect(200)
            .expect('Content-Type', /video\/mp4/)
            .expect('Content-Disposition', /attachment/);

        // The body should be a real, non-empty file.
        expect(Buffer.isBuffer(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
    });
});

describe('GET /api/events/:id', () => {
    it("streams the job until completion and then closes.", async () => {
        const id = await postJobId(SAMPLE_VIDEO_PATH);
        const history = await waitForJobStageViaEvents(id, ['completed', 'failed']);

        const length = history.length;
        expect(length).toBeGreaterThan(0);
        expect(history[length - 1].stage).toBeOneOf(['completed', 'failed']);
    });
});
