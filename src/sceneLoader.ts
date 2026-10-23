// three.js is most of the page's code, so each 3D view is loaded once it is about to scroll into view;
// a view hidden with display: none (the subnet grid for IPv6) waits until it is shown

import type { SceneView, SubnetScene } from './subnet3d';
import { themeColor } from './theme';

const scenes: SubnetScene[] = [];

// onLoad gets the scene once it exists; it never runs if WebGL is unavailable
export const loadSceneWhenVisible = function(container: HTMLElement, tooltip: HTMLElement, onLoad: (scene: SubnetScene) => void, view?: SceneView): void {
  const load = async function(): Promise<void> {
    container.classList.add('subnet-3d-loading');
    let scene: SubnetScene;
    try {
      const { SubnetScene } = await import('./subnet3d');
      scene = new SubnetScene(container, tooltip, view);
    } catch (error) {
      container.classList.add('subnet-3d-unavailable');
      container.textContent = '3D view unavailable in this browser.';
      return;
    } finally {
      container.classList.remove('subnet-3d-loading');
    }

    scene.setBackground(themeColor('--scene-bg'));
    scenes.push(scene);
    onLoad(scene);
  }

  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      observer.disconnect();
      load();
    }
  }, { rootMargin: '300px' });
  observer.observe(container);
}

// recolors every loaded scene for the current theme
export const updateSceneBackgrounds = function(): void {
  scenes.forEach(scene => scene.setBackground(themeColor('--scene-bg')));
}
