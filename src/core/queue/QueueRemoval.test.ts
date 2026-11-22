import {expect,it} from 'vitest';
import {Queue} from './Queue';
const tracks=['a','b','c','d','e'].map(id=>({id,title:id,provider:'local',uri:`asset:///${id}`}));
it('deleting the current shuffle item preserves the upcoming playback order',()=>{
 const q=new Queue({rng:()=>.3});q.replace(tracks);q.setShuffle(true);
 const upcoming=q.peekAhead(10).map(t=>t.id);expect(upcoming.length).toBeGreaterThan(0);
 q.removeAt(q.currentIndex());
 expect([q.current()!.id,...q.peekAhead(10).map(t=>t.id)]).toEqual(upcoming);
});
