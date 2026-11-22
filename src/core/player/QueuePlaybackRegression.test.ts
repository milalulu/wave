import {afterEach, expect, it, vi} from 'vitest';
import {PlayerEngine} from './PlayerEngine';
import {MockAudioAdapter} from './PlayerAdapter';
import type {Track} from '../types';
const tracks:Track[]=['a','b','c'].map(id=>({id,title:id,provider:'local',uri:`asset:///${id}`}));
const active:PlayerEngine[]=[];
afterEach(()=>{active.splice(0).forEach(e=>e.destroy());});
function setup(){const adapter=new MockAudioAdapter();const engine=new PlayerEngine(adapter);active.push(engine);return {engine,adapter};}
it('play next starts the first item in an empty queue',async()=>{
 const {engine,adapter}=setup();await engine.playNext(tracks[0]);
 expect(engine.snapshot.current?.id).toBe('a');expect(adapter.src).toBe(tracks[0].uri);expect(adapter.state).toBe('playing');
});
it('play an already queued item selects that item rather than the last one',async()=>{
 const {engine,adapter}=setup();await engine.playTracks(tracks);
 expect(engine.addToQueue(tracks[1],true)).toBe(false);
 await vi.waitFor(()=>expect(adapter.src).toBe(tracks[1].uri));expect(engine.snapshot.current?.id).toBe('b');
});
it('removing the playing item advances audio and metadata to its successor',async()=>{
 const {engine,adapter}=setup();await engine.playTracks(tracks,1);engine.removeFromQueue(1);
 await vi.waitFor(()=>expect(adapter.src).toBe(tracks[2].uri));expect(engine.snapshot.current?.id).toBe('c');
});
it('removing a paused item keeps the replacement paused until play',async()=>{
 const {engine,adapter}=setup();await engine.playTracks(tracks);engine.pause();engine.removeFromQueue(0);
 expect(engine.snapshot.current?.id).toBe('b');expect(adapter.state).toBe('paused');
 await engine.play();expect(adapter.src).toBe(tracks[1].uri);
});
it('removing the final item stops audio and clears current metadata',async()=>{
 const {engine,adapter}=setup();await engine.playTrack(tracks[0]);const onTrack=vi.fn();engine.on('track',onTrack);
 engine.removeFromQueue(0);expect(adapter.state).toBe('paused');expect(engine.snapshot.current).toBeNull();expect(engine.snapshot.state).toBe('idle');expect(onTrack).toHaveBeenCalledWith(null);
});
it('late adapter events cannot revive a cleared queue or stale progress',async()=>{
 const {engine,adapter}=setup();await engine.playTrack(tracks[0]);adapter.tick(25);engine.clearQueue();
 adapter.setState('paused');adapter.tick(25);adapter.setState('playing');
 expect(engine.snapshot.state).toBe('idle');expect(engine.snapshot.position).toBe(0);expect(engine.snapshot.duration).toBe(0);
});
it('removing a loading track cancels its late resolver',async()=>{
 const adapter=new MockAudioAdapter();let finish!:(uri:string)=>void;
 const pending=new Promise<string>(resolve=>{finish=resolve;});
 const engine=new PlayerEngine(adapter,{resolveUri:t=>t.id==='a'?pending:Promise.resolve(t.uri)});active.push(engine);
 const starting=engine.playTracks(tracks);engine.removeFromQueue(0);
 await vi.waitFor(()=>expect(adapter.src).toBe(tracks[1].uri));
 finish(tracks[0].uri);await starting;
 expect(adapter.src).toBe(tracks[1].uri);expect(engine.snapshot.current?.id).toBe('b');
});
it('removing another queue item does not restart the current audio',async()=>{
 const {engine,adapter}=setup();await engine.playTracks(tracks,1);adapter.tick(18);
 const load=vi.spyOn(adapter,'load');engine.removeFromQueue(0);
 expect(engine.snapshot.current?.id).toBe('b');expect(adapter.position).toBe(18);expect(load).not.toHaveBeenCalled();
});
