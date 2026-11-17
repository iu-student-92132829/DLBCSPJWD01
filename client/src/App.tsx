import type { Component } from 'solid-js';
import Header from './components/Header';
import Content from './components/Content';

const App: Component = () => {
  return (
    <div id="app" class="flex min-h-screen flex-col">
      <div class="flex-none"><Header /></div>
      <div class="flex-1 flex flex-col"><Content /></div>
    </div>
  );
};

export default App;
