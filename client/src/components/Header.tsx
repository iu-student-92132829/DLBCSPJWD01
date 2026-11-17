import type { Component } from 'solid-js';

const Header: Component = () => {
    return (
        <header id="header" class="w-full border-b border-gray-200 bg-gray-50 text-gray-900">
            {/* Center on small screens, on the left on larger screens. */}
            <div class="mx-auto flex max-w-6xl items-center justify-center px-4 py-3 md:justify-start md:px-6 md:py-4">
                <h1 class="text-center text-lg font-bold sm:text-xl md:text-left md:text-2xl">
                    Video speed & reversal tool
                </h1>
            </div>
        </header>
    );
};

export default Header;
