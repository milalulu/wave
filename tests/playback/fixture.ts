import {PlayerEngine} from '../../src/core/player/PlayerEngine';
import {WebAudioAdapter} from '../../src/core/player/WebAudioAdapter';
import {OutputRouter} from '../../src/core/player/OutputRouter';
import {watchConnectivity} from '../../src/app/connectivity';
function tone(hz:number) {
 const rate=16000,n=rate*6,bytes=new ArrayBuffer(44+n*2),d=new DataView(bytes);
 const str=(offset:number,s:string)=>[...s].forEach((c,i)=>d.setUint8(offset+i,c.charCodeAt(0)));
 str(0,'RIFF');d.setUint32(4,36+n*2,true);str(8,'WAVE');str(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,rate,true);d.setUint32(28,rate*2,true);d.setUint16(32,2,true);d.setUint16(34,16,true);str(36,'data');d.setUint32(40,n*2,true);
 for(let i=0;i<n;i++)d.setInt16(44+i*2,Math.sin(i*2*Math.PI*hz/rate)*1000,true);
 return URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
}
class TestAudioAdapter extends WebAudioAdapter {
 private notifyError?: (message: string) => void;

 override onError(callback: (message: string) => void) {
  this.notifyError = callback;
  return super.onError(callback);
 }

 interruptStream() {
  this.notifyError?.("network error");
 }
}
const adapter=new TestAudioAdapter();adapter.setCrossfadeMs(0);
const engine=new PlayerEngine(new OutputRouter(adapter), {
 resolveUri: async (track) => {
  if (!navigator.onLine) throw new Error("offline");
  return track.uri;
 },
});
const stopConnectivity = watchConnectivity((status) => {
 if (status === "online") void engine.resumeAfterReconnect();
});
const tracks=[220,330,440].map((hz,i)=>({id:String(i),title:`Generated test tone ${i}`,provider:'local',uri:tone(hz),duration:6}));
const errors:string[]=[];let played=0;engine.on('error',e=>errors.push(e));engine.on('played',()=>played++);
Object.assign(window,{audioTest:{engine,tracks,errors,get played(){return played;},interruptStream(){adapter.interruptStream();},dispose(){stopConnectivity();engine.destroy();tracks.forEach(t=>URL.revokeObjectURL(t.uri));}}});
