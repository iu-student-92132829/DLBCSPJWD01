export class FileTypeError extends Error {
    public receivedFileType: string;

    constructor(mimetype: string) {
        super(`Invalid file type '${mimetype}'. Only video files are allowed.`);
        this.name = 'FileTypeError';
        this.receivedFileType = mimetype;
    }
}
