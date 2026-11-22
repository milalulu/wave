// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MobilePlayerBar, MobileTopBar } from './MobileNav';
import { I18nProvider } from './I18nContext';
import { useApp } from '../app/stores';
import { setLocale } from '../core/i18n';
const original = useApp.getState();
afterEach(() => { cleanup(); useApp.setState(original); vi.unstubAllGlobals(); });
it('mobile buffering cannot start overlapping play requests', () => {
  setLocale('en'); const toggle = vi.fn();
  useApp.setState({ services: null, togglePlay: toggle, snapshot: { ...original.snapshot, state: 'loading', current: { id: 'a', provider: 'local', title: 'A', uri: '' } } });
  render(<I18nProvider><MobilePlayerBar onOpenPlayer={() => {}} onOpenQueue={() => {}} /></I18nProvider>);
  const button = screen.getByRole('button', { name: /loading/i }) as HTMLButtonElement;
  expect(button.disabled).toBe(true); fireEvent.click(button); expect(toggle).not.toHaveBeenCalled();
});
it('mobile artwork uses the selected source when the catalog cover is absent', () => {
  setLocale('en'); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  useApp.setState({ services: null, snapshot: { ...original.snapshot, current: { id: 'a', provider: 'local', title: 'A', uri: '', playbackSource: { id: 's', provider: 'youtube', title: 'A', uri: '', coverUrl: 'https://example.test/cover.jpg' } } } });
  const { container } = render(<I18nProvider><MobilePlayerBar onOpenPlayer={() => {}} onOpenQueue={() => {}} /></I18nProvider>);
  expect(container.querySelector('.mini-cover')?.getAttribute('src')).toBe('https://example.test/cover.jpg');
});
it('mobile back control has an accessible name', () => {
  setLocale('en'); const back = vi.fn();
  render(<I18nProvider><MobileTopBar view='queue' canGoBack onBack={back} /></I18nProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Back' })); expect(back).toHaveBeenCalledOnce();
});
