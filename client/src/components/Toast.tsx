import { Show, type Component } from 'solid-js';

interface ToastProps {
    message: string | undefined;
}

/**
 * Displays a toast at the bottom of the screen.
 */
const Toast: Component<ToastProps> = (props) => {
    return (
        <Show when={props.message}>
            {(message) => (
                <div
                    role="alert"
                    class="fixed bottom-4 left-1/2 max-w-[90vw] -translate-x-1/2 rounded bg-gray-900 px-4 py-2 text-sm text-white shadow-lg"
                >
                    {message()}
                </div>
            )}
        </Show>
    );
};

export default Toast;
