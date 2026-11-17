import fs from 'node:fs';
import { OUTPUT_DIR, UPLOAD_DIR } from './setup.js';
import path from 'node:path';
import ffmpeg from '@modernized/fluent-ffmpeg';
import { Request, Response } from 'express';

export type UUID = string;

// Get the paths of files in the upload/output directories.

/**
 * Get the upload path making sure the file exists.
 */
export function getUploadPath(id: UUID, ext: string): string | undefined {
    const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
    const filePath = path.join(UPLOAD_DIR, `${id}.${cleanExt}`);
    return fs.existsSync(filePath) ? filePath : undefined;
}

/**
 * Get the destined output path.
 */
export function getOutputTargetPath(id: UUID, ext: string): string {
    const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
    const filePath = path.join(OUTPUT_DIR, `${id}.${cleanExt}`);
    return filePath;
}

/**
 * Get the output path making sure the file exists.
 */
export function getOutputPath(id: UUID, ext: string): string | undefined {
    const filePath = getOutputTargetPath(id, ext);
    return fs.existsSync(filePath) ? filePath : undefined;
}


/**
 * Gets the duration of an uploaded file using ffprobe.
 * Returns undefined if the upload path doesn't exist OR the duration is not a valid number.
 * This process happens asynchronously.
 */
export async function getUploadDuration(id: UUID, ext: string): Promise<number | undefined> {
    const uploadPath = getUploadPath(id, ext);
    if (uploadPath === undefined) return undefined;

    return new Promise((resolve, _) => {
        ffmpeg.ffprobe(uploadPath, (err, data) => {
            if (err) return resolve(undefined); // No progress reporting.

            const duration = data.format.duration;

            if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
                resolve(duration);
            } else {
                resolve(undefined);
            }
        });
    });
}

/**
 * Rejects an upload requests and unlinks the associated file.
 */
export function rejectUpload(req: Request, res: Response, error: string) {
    if (req.file) fs.unlink(req.file.path, () => { });
    return res.status(400).json({ error });
}
