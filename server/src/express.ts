import express from 'express';
import multer from 'multer'
import { MAX_SPEED, MAX_UPLOAD_MB, MIN_SPEED, UPLOAD, UUID_RE } from './setup.js';
import { FileTypeError } from './exceptions.js'
import path from 'node:path';
import { addJob, getJob, JobData, JobStage, offJobEvent, onJobEvent } from './jobs.js';
import { getOutputPath, rejectUpload } from './utils.js';

const app = express();

app.post('/api/upload', UPLOAD.single('video'), (req, res) => {
    if (!req.file) {
        return rejectUpload(req, res, 'No video file provided.');
    }

    let task = req.body.task;

    // Parse the task in case it's a string.
    if (typeof task === 'string') {
        try { task = JSON.parse(task); } catch (e) {
            return rejectUpload(req, res, 'Task is not valid JSON.');
        }
    }

    if (task === undefined || typeof task !== 'object' || Array.isArray(task)) {
        return rejectUpload(req, res, 'Task must be a valid object.');
    }

    // Tasks consists of a speed, if the video should be reversed, and if the video should be muted.

    const speed = task.speed;
    const reverse = task.reverse;
    const mute = task.mute;

    if (typeof speed !== "number" || typeof reverse !== "boolean" || typeof mute !== "boolean") {
        return rejectUpload(req, res, 'Task must provide a number for "speed" and a boolean for "reverse" and "mute".');
    }

    if (speed < MIN_SPEED || speed > MAX_SPEED) {
        return rejectUpload(req, res, `Speed must be between ${MIN_SPEED} and ${MAX_SPEED}.`);
    }

    const parsedPath = path.parse(req.file.filename);
    const jobUUID = parsedPath.name;
    const jobExt = parsedPath.ext;

    // Add the job to the queue to process.
    addJob(jobUUID, jobExt, speed, reverse, mute);

    return res.status(200).json({
        message: 'Upload successful',
        id: jobUUID
    });
});

// Get the status of a job, returning all of its details.
app.get('/api/status/:id', (req, res) => {
    const { id } = req.params;
    const job = getJob(id);

    if (job === undefined) {
        return res.status(404).json({ error: `No job exists with the id ${id}.` });
    }

    return res.status(200).json(job);
});

// Updates the client based on the progress of their upload.
app.get('/api/events/:id', (req, res) => {
    const { id } = req.params;
    const job = getJob(id);

    if (job === undefined) {
        return res.status(404).json({ error: `No job exists with the id ${id}.` });
    }

    // Make sure the stream doesn't die.
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    // Immediately send the headers.
    res.flushHeaders();


    const listener = (jobData: JobData) => {
        res.write(`data: ${JSON.stringify(jobData)}\n\n`);

        // End the stream if the job completes or fails.
        if (jobData.stage === JobStage.Completed || jobData.stage === JobStage.Failed) {
            offJobEvent(id, listener);
            res.end();
        }
    };

    // Subscribe as long as it stays open.
    onJobEvent(id, listener);

    // Stop listening if the client disconnects.
    req.on('close', () => {
        offJobEvent(id, listener);
    });

    listener({ ...job });
});

// Download the resulting video of a job.
app.get('/api/download/:id', (req, res) => {
    const { id } = req.params;
    const job = getJob(id);

    if (job === undefined) {
        return res.status(404).json({ error: `No job exists with the id ${id}.` });
    } else if (job.stage === JobStage.Failed) {
        // 422 = unprocessable content
        return res.status(422).json({ error: job.error ?? 'The job failed.' });
    } else if (job.stage !== JobStage.Completed) {
        // 409 = conflict
        return res.status(409).json({ error: `The job with id ${id} is still being processed.` });
    }

    const outputPath = getOutputPath(id, job.ext);
    if (outputPath === undefined) {
        return res.status(404).json({ error: 'The processed video no longer exists.' });
    }

    return res.download(outputPath, `${id}${job.ext}`, (err) => {
        // Send an error if the download hasn't already started.
        if (err && !res.headersSent) {
            res.status(500).json({ error: 'Failed to send the video.' });
        }
    });
});

// Validate all uses of the 'id' parameter to be a valid UUID.
app.param('id', (req, res, next, id) => {
    if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: 'Invalid id' });
    }
    next();
});


app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Multer error if the file size exceeds MAX_UPLOAD_BYTES.
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `File is too large. Maximum allowed size is ${MAX_UPLOAD_MB}MB.` });
    }

    // Multer error if the file filter detects a non-video file.
    if (err instanceof FileTypeError) {
        return res.status(400).json({ error: err.message, receivedFileType: err.receivedFileType });
    }

    res.status(500).json({ error: err.message });
});

export default app;
