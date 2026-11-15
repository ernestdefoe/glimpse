import Viewer, { type ViewerOptions } from './Viewer';

let mounted: HTMLElement | null = null;

/** Opens the viewer over the page. One at a time. */
export function openViewer(options: ViewerOptions): void {
  closeViewer();
  mounted = document.createElement('div');
  mounted.className = 'GlimpseViewer-root';
  document.body.appendChild(mounted);
  const close = () => {
    closeViewer();
    options.onclose?.();
    m.redraw();
  };
  m.mount(mounted, { view: () => <Viewer options={options} close={close} /> });
}

export function closeViewer(): void {
  if (!mounted) return;
  m.mount(mounted, null);
  mounted.remove();
  mounted = null;
}
