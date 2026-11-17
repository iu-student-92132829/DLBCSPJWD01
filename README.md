# Video speed & reversal tool

This is a web application that allows you to change the speed of a video, reverse it, and mute it.
This project was made for the course Project Java and Web Development (DLBCSPJWD01).

## Usage

1. Upload a video up to 512 MB.
2. Choose a speed between 0.1× and 16× and if you want to reverse/mute it.
3. The server will queue the video for processing and show the progress.
4. The result can be viewed and downloaded.

## Packages used

- Front-end: Solid.js, typescript, tailwind, and vite.
- Back-end: Node.js, express, typescript, and multer.
- Video processing: FFmpeg via the fluent-ffmpeg package, binaries are also installed with a package.
- Testing: Vitest and supertest.

## Design

Videos are processed server-side due to the browser being unable to reliably handle large videos and/or video reversal.
The server queues these jobs to reduce CPU and memory load. Progress is sent to the client using events instead of polling.
Solid.js and tailwind were used to keep the front-end small due to the project not requiring complex visual or design on the front-end.

## Installation

You need Node.js 20.19 or newer and at least 8 GB of RAM.

```bash
npm install
npm run setup
npm run dev
```

The website can then be tested using the url in the terminal.

## Tests

```bash
npm test
```

### API

- `POST /api/upload`: upload a video with its settings returning a job id.
- `GET /api/status/:id`: current state of a job.
- `GET /api/events/:id`: live updates of a job.
- `GET /api/download/:id`: download the finished video.

## Limitations

- Uploads are limited to 32 MB. Reversing a video needs memory equal to 170 times its file size. The 32 MB upload limit only uses ~5.5 GB of RAM, which fits in 8 GB of RAM.
- Uploaded and processed files are temporary. They are deleted when the server restarts.
