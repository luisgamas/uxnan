import { getContext, setContext } from 'svelte';

const VIEW_COMPOSER = Symbol('view-composer');
type ViewComposer = (text: string) => void;

export function provideViewComposer(insert: ViewComposer): void {
  setContext(VIEW_COMPOSER, insert);
}

export function useViewComposer(): ViewComposer | undefined {
  return getContext<ViewComposer | undefined>(VIEW_COMPOSER);
}
