// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
vi.mock('../app/compose',()=>({searchAll:vi.fn()}));
import {useApp} from '../app/stores';
import {SearchView} from './SearchView';
import {I18nProvider} from './I18nContext';
import {setLocale} from '../core/i18n';
afterEach(cleanup);
it('renders and updates before provider services are initialized',()=>{
 setLocale('en');
 useApp.setState({services:null});
 const tree=(query:string)=><I18nProvider><SearchView query={query} onQuery={()=>{}} /></I18nProvider>;
 const {rerender}=render(tree(''));
 expect(screen.getByPlaceholderText('Search...')).toBeTruthy();
 rerender(tree('test'));
 expect(screen.getByRole('button',{name:/^Search$/})).toBeTruthy();
});
