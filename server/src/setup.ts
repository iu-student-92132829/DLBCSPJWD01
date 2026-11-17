import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer'
import { FileTypeError } from './exceptions.js';
import ffmpeg from '@modernized/fluent-ffmpeg'
import fsExtra from 'fs-extra/esm';

export const PORT = 3000;
export const MAX_UPLOAD_MB = 32;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024; // Exacts bytes for maximum upload.
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 16;

// Resolve no matter where we run the server from.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const UPLOAD_DIR = path.join(ROOT, 'uploads');
export const OUTPUT_DIR = path.join(ROOT, 'outputs');

// Empty the outputs/ and uploads/ directories in case the server was stopped during processing.
try {
    await fsExtra.emptyDir(UPLOAD_DIR);
} catch (err) {
    console.warn("Warning: Could not empty the upload directory.");
    process.exit(1);
}

try {
    await fsExtra.emptyDir(OUTPUT_DIR);
} catch (err) {
    console.warn("Warning: Could not empty the output directory.");
    process.exit(1);
}

// FFmpeg path may differ based on how the program is run, therefore, both cases are handled.
export const FFMPEG_PATH = typeof ffmpegPath === 'string'
    ? ffmpegPath
    : (ffmpegPath as unknown as { default: string })?.default;

if (!FFMPEG_PATH) {
    console.warn('Warning: FFMPEG binary path could not be resolved. Exiting process.');
    process.exit(1);
}

ffmpeg.setFfmpegPath(FFMPEG_PATH);

// Same thing for ffprobe.
export const FFPROBE_PATH: string | undefined =
    (ffprobeStatic as { path?: string }).path
    ?? (ffprobeStatic as unknown as { default: { path: string } })?.default?.path;

if (!FFPROBE_PATH) {
    console.warn('Warning: FFPROBE binary path could not be resolved. Exiting process.');
    process.exit(1);
}

ffmpeg.setFfprobePath(FFPROBE_PATH)

// Setup storage to preserve the file format.
export const STORAGE = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);

        cb(null, `${randomUUID()}${ext}`);
    }
});

// Setup upload to handle the upload limit and reject non-video files.
export const UPLOAD = multer({
    storage: STORAGE,
    limits: {
        fileSize: MAX_UPLOAD_BYTES,
    },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new FileTypeError(file.mimetype))
        }
    },
});

// Regex for a UUID.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
