import { createMemo, createSignal, JSX, Match, onCleanup, Show, Switch, type Component } from 'solid-js';
import Toast from './Toast';

enum Stage {
    Upload = 'upload',
    Settings = 'settings',
    Processing = 'processing',
    Result = 'result',
    Error = 'error',
}

enum ResetType {
    None = 'none',
    Soft = 'soft',
    Hard = 'hard',
}

const MIN_SPEED = 0.1;
const MAX_SPEED = 16;

const Content: Component = () => {
    const [stage, setStage] = createSignal<Stage>(Stage.Upload);
    const [videoFile, setVideoFile] = createSignal<File | undefined>(undefined);
    const [jobId, setJobId] = createSignal<string | undefined>(undefined);

    const [jobStage, setJobStage] = createSignal<'enqueued' | 'processing' | 'completed' | 'failed' | undefined>(undefined);
    const [jobQueuePosition, setJobQueuePosition] = createSignal<number | undefined>(undefined);
    const [jobProgress, setJobProgress] = createSignal<number | undefined>(undefined);

    const [speed, setSpeed] = createSignal(1);
    const [reverse, setReverse] = createSignal(false);
    const [muted, setMuted] = createSignal(false);

    const [errorMessage, setErrorMessage] = createSignal<string | undefined>();
    const [errorResetType, setErrorResetType] = createSignal<ResetType>(ResetType.None);
    const [toast, setToast] = createSignal<string | undefined>();

    let toastTimer: number | undefined;
    onCleanup(() => clearTimeout(toastTimer));

    let fileInputRef: HTMLInputElement | undefined;
    let eventSource: EventSource | undefined;

    // Make sure the previous URL revokes on clean up.
    const previewUrl = createMemo(() => {
        const file = videoFile();
        if (!file) return undefined;

        const url = URL.createObjectURL(file);
        onCleanup(() => URL.revokeObjectURL(url));

        return url;
    });

    /**
     * Show a minor error to the user via a toast pop up.
     */
    const showToast = (message: string) => {
        clearTimeout(toastTimer);
        setToast(message);
        toastTimer = setTimeout(() => setToast(undefined), 4000);
    };

    /**
     * Show a major error to the user by going to
     */
    const showError = (message: string, resetType: ResetType) => {
        eventSource?.close();
        eventSource = undefined;
        setErrorMessage(message);
        setErrorResetType(resetType);
        setStage(Stage.Error);
    };

    /**
     * Sets the video file if it is an actual file.
     */
    const handleFileChange: JSX.EventHandler<HTMLInputElement, Event> = (e) => {
        const file = e.currentTarget.files?.[0];

        if (file && file.type.startsWith("video/")) {
            setVideoFile(file);
        } else {
            showToast("Please select a valid video file.");
        }
    };

    /**
     * Submits a job to the server based on the current settings.
     * The stage will automatically be set to 'processing' if it is successful.
     * An event source is registered that will automatically set the stage to 'result' if the job finishes.
     */
    const submitJob = async () => {
        const file = videoFile();
        if (!file) return;

        const form = new FormData();

        form.append("task", JSON.stringify({
            speed: speed(),
            reverse: reverse(),
            mute: muted(),
        }));

        form.append("video", file);

        try {
            const result = await fetch("/api/upload", {
                method: "POST",
                body: form,
            });

            const data = await result.json();

            if (!result.ok) {
                throw new Error(data.error ?? `Upload failed (${result.status})`);
            }

            setJobId(data.id);
            setStage(Stage.Processing);

            // Register an event source that listens to queue/progress data and stage changes.
            eventSource = new EventSource(`/api/events/${data.id}`);

            eventSource.onmessage = (event) => {
                const jobData = JSON.parse(event.data);

                setJobStage(jobData.stage);
                setJobQueuePosition(jobData.queuePosition);
                setJobProgress(jobData.processingProgress);

                if (jobData.stage === "failed") {
                    showError(jobData.error ?? "Video processing failed.", ResetType.Soft);
                } else if (jobData.stage === "completed") {
                    eventSource?.close();
                    eventSource = undefined;
                    setStage(Stage.Result);
                }
            };

            eventSource.onerror = () => {
                eventSource?.close();
                eventSource = undefined;
                showError("Lost connection to the server.", ResetType.Soft);
            };
        } catch (err) {
            showError(err instanceof Error ? err.message : "Upload failed.", ResetType.Soft);
        }
    };

    /**
     * Resets only variables related to the submitted job.
     */
    const softReset = (stage: Stage = Stage.Settings) => {
        // Stop listening to the old job.
        eventSource?.close();
        eventSource = undefined;

        // Clear the upload and job state.
        setJobId(undefined);
        setJobStage(undefined);
        setJobQueuePosition(undefined);
        setJobProgress(undefined);

        setStage(stage);
    };

    /**
     * Resets variables related to a submitted job.
     * Additionally resets all user inputs.
     */
    const hardReset = () => {
        // Reset the upload.
        setVideoFile(undefined);
        if (fileInputRef) fileInputRef.value = '';

        // Reset settings back to their default values.
        setSpeed(1);
        setReverse(false);
        setMuted(false);

        softReset(Stage.Upload);
    };

    /**
     * Either doesn't reset, does a soft reset, or a hard reset depending on the error reset type variable.
     */
    const variableReset = () => {
        switch (errorResetType()) {
            case ResetType.None:
                break;
            case ResetType.Soft:
                softReset();
                break;
            case ResetType.Hard:
                hardReset();
                break;
        }
    };

    return (
        <div id="content" class="flex flex-1 flex-col justify-center items-center gap-4 w-full">
            <Show when={toast()}>
                {(message) => (
                    <Toast message={message()} />
                )}
            </Show>

            <Switch>
                <Match when={stage() === Stage.Upload}>
                    {/* Hidden file input. */}
                    <input
                        type="file"
                        accept="video/*"
                        ref={fileInputRef}
                        style={{ display: "none" }}
                        onChange={handleFileChange}
                    />

                    {/* Change the button's size based on the viewport. */}
                    <Show when={!videoFile()}>
                        <button onClick={() => { fileInputRef?.click(); }}
                            class="btn-primary w-[min(90%,24rem)] text-[clamp(1.25rem,5vw,2rem)] shrink-0">Upload</button>
                    </Show>

                    <Show when={videoFile()}>
                        {(file) => (
                            /* Make sure there's always a gap at the edges. */
                            <div class="w-full px-6 flex flex-col items-center">
                                <p>{file().name} ({(file().size / (1024 * 1024)).toFixed(2)} MB)</p>
                                <Show when={previewUrl()}>
                                    {(url) => (
                                        /* Make sure vertical videos don't move out of the page. */
                                        <video src={url()} controls class="w-auto max-w-full max-h-[70vh] mx-auto block" />
                                    )}
                                </Show>

                                <div class="flex justify-center gap-4 mt-4">
                                    <button onClick={() => { fileInputRef?.click(); }}
                                        class="btn-secondary">Upload</button>

                                    <button onClick={() => { setStage(Stage.Settings) }}
                                        class="btn-primary">Continue</button>
                                </div>
                            </div>
                        )}
                    </Show>
                </Match>
                <Match when={stage() === Stage.Settings}>
                    {/* Make the spacing consistents. */}
                    <div class="flex w-full max-w-sm flex-col items-center gap-4 px-6">
                        {/* Video processing settings. */}

                        {/* Speed. */}
                        <div class="flex items-center gap-2">
                            <label for="speed">Speed</label>
                            <input
                                id="speed"
                                type="number"
                                min={MIN_SPEED}
                                max={MAX_SPEED}
                                step="0.1"
                                value={speed()}
                                onChange={(e) => {
                                    const parsed = e.currentTarget.valueAsNumber;
                                    const next = Number.isNaN(parsed) ? speed() : Math.min(MAX_SPEED, Math.max(MIN_SPEED, parsed));
                                    setSpeed(next);

                                    // Show the clamped value.
                                    e.currentTarget.value = String(next);
                                }}
                            />
                            <span>×</span>
                        </div>
                        <p class="text-sm text-gray-500">Allowed range: 0.1× - 16×</p>

                        <div class="flex flex-col gap-2">
                            {/* Reverse. */}
                            <label class="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={reverse()}
                                    onChange={(e) => setReverse(e.currentTarget.checked)}
                                />
                                Reverse
                            </label>

                            {/* Mute. */}
                            <label class="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={muted()}
                                    onChange={(e) => setMuted(e.currentTarget.checked)}
                                />
                                Mute
                            </label>
                        </div>

                        <div class="mt-4 flex flex-wrap justify-center gap-3">
                            <button onClick={() => submitJob()}
                                class="btn-primary">Process</button>

                            <button onClick={hardReset}
                                class="btn-secondary">Restart</button>
                        </div>
                    </div>
                </Match>
                <Match when={stage() === Stage.Processing}>
                    <Switch>
                        <Match when={jobStage() === 'enqueued'}>
                            <div class="text-[4vw]">
                                Queue position: {jobQueuePosition()}
                            </div>
                        </Match>
                        <Match when={jobStage() === 'processing'}>
                            <div class="w-full max-w-md px-6 flex flex-col gap-2">
                                <div class="flex justify-between text-sm">
                                    <span>Processing...</span>
                                    <span>{Math.round((jobProgress() ?? 0) * 100)}%</span>
                                </div>

                                {/* Track */}
                                <div
                                    class="h-3 w-full overflow-hidden rounded-full bg-gray-200"
                                    role="progressbar"
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={Math.round((jobProgress() ?? 0) * 100)}
                                >
                                    {/* Fill */}
                                    <div
                                        class="h-full rounded-full bg-blue-500 transition-[width] duration-300 ease-out"
                                        style={{ width: `${Math.min(1, Math.max(0, jobProgress() ?? 0)) * 100}%` }}
                                    />
                                </div>
                            </div>
                        </Match>
                    </Switch>
                </Match>
                <Match when={stage() === Stage.Result}>
                    { /* Make sure there's always a gap at the edges. */}
                    <div class="w-full px-6 flex flex-col items-center">
                        <Switch>
                            <Match when={jobStage() === 'completed'}>
                                <Show when={jobId()}>
                                    {(id) => (
                                        <>
                                            {/* Show both a preview and a download button. */}
                                            <video src={`/api/download/${id()}`} controls class="w-auto max-w-full max-h-[70vh] mx-auto block" />
                                            <a href={`/api/download/${id()}`} download="" class="btn-primary mt-4 inline-block">Download</a>
                                        </>
                                    )}
                                </Show>
                            </Match>
                        </Switch>

                        <div class="mt-4 flex flex-wrap justify-center gap-3">
                            <button onClick={() => softReset()}
                                class="btn-secondary">Change settings</button>
                            <button onClick={hardReset}
                                class="btn-secondary">Restart</button>
                        </div>
                    </div>
                </Match>
                <Match when={stage() === Stage.Error}>
                    <div class="flex flex-col items-center gap-3 px-6 text-center">
                        <p class="text-red-600">{errorMessage()}</p>
                        <button onClick={variableReset}
                            class="btn-primary">Return</button>
                    </div>
                </Match>
            </Switch>
        </div>
    );
};

export default Content;
