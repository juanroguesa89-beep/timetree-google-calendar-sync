import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyncEngine } from '../src/sync-engine.js';
import { getSourceSyncVersion } from '../src/gcal-client.js';
import { parseIcsFile } from '../src/ics-parser.js';
import type { CalendarEvent } from '../src/types.js';
const event: CalendarEvent = { uid:'a', summary:'Private', description:'', location:'', start:new Date('2026-03-29T00:00:00Z'), end:new Date('2026-03-30T00:00:00Z'), allDay:true, recurrence:[], lastModified:null, category:'', color:'' };
const engine = new SyncEngine({} as any);
test('content hash is idempotent and detects edits without LAST-MODIFIED', () => {
 const target = [{googleEventId:'g', timetreeUid:'a', lastModified:getSourceSyncVersion(event), colorId:''}];
 assert.equal(engine.computeDiff([event],target).toUpdate.length,0);
 assert.equal(engine.computeDiff([{...event,location:'changed'}],target).toUpdate.length,1);
});
test('duplicates abort before writes', () => {
 assert.throws(()=>engine.computeDiff([event,event],[]));
 const t={googleEventId:'g',timetreeUid:'a',lastModified:'',colorId:''};
 assert.throws(()=>engine.computeDiff([event],[t,t]));
});
test('dry run does not invoke mutations including deletion', async () => {
 const result=await engine.applyDiff({toCreate:[event],toUpdate:[],toDelete:[{googleEventId:'g',timetreeUid:'a'}]});
 assert.equal(result.created+result.updated+result.deleted,0);
});
function parse(body:string) {
 const dir=mkdtempSync(join(tmpdir(),'ics-test-'));
 try { const file=join(dir,'test.ics'); writeFileSync(file,body); return parseIcsFile(file); }
 finally {rmSync(dir,{recursive:true,force:true});}
}
const block='BEGIN:VEVENT\nUID:a\nDTSTART;VALUE=DATE:20260329\nDTEND;VALUE=DATE:20260330\nSUMMARY:Test\nEND:VEVENT';
const wrap=(s:string)=>`BEGIN:VCALENDAR\nVERSION:2.0\n${s}\nEND:VCALENDAR\n`;
test('all day dates and exclusive end survive DST',()=>{
 const [e]=parse(wrap(block));assert.equal(e.start.toISOString(),'2026-03-29T00:00:00.000Z');assert.equal(e.end.toISOString(),'2026-03-30T00:00:00.000Z');assert.equal(e.allDay,true);
});
test('invalid/truncated, duplicate and unsupported recurrence input fail closed',()=>{
 assert.throws(()=>parse(wrap(block).replace('END:VCALENDAR','')));
 assert.throws(()=>parse(wrap(block+'\n'+block)));
 for(const property of ['RRULE:FREQ=DAILY','EXDATE:20260330T100000Z','RECURRENCE-ID:20260329T100000Z','STATUS:CANCELLED']) assert.throws(()=>parse(wrap(block.replace('SUMMARY:Test',property))));
});
test('valid empty calendar differs from invalid input',()=>{ assert.deepEqual(parse(wrap('')),[]); assert.throws(()=>parse('')); });
test('Google payload clears removed fields, preserves dates and deterministic insert ID', async()=>{
 const {GCalClient}=await import('../src/gcal-client.js');
 const client=new GCalClient({},'fake-calendar');
 const bodies:any[]=[];
 (client as any).calendar={events:{insert:async (p:any)=>{bodies.push(p.requestBody);return {data:{id:p.requestBody.id}};},patch:async(p:any)=>{bodies.push(p.requestBody);}}};
 const id=await client.createEvent(event);
 assert.equal(await client.createEvent(event),id);
 assert.match(id,/^[a-f0-9]{64}$/);
 await client.updateEvent('legacy-id',event);
 assert.equal(bodies[2].description,'');assert.equal(bodies[2].location,'');
 assert.deepEqual(bodies[2].recurrence,[]);
 assert.deepEqual(bodies[2].start,{date:'2026-03-29'});
 assert.deepEqual(bodies[2].end,{date:'2026-03-30'});
});
test('explicit timezone instants survive a summer-time transition',()=>{
 const timed=block.replace('DTSTART;VALUE=DATE:20260329','DTSTART;TZID=Europe/Madrid:20260329T090000').replace('DTEND;VALUE=DATE:20260330','DTEND;TZID=Europe/Madrid:20260329T100000');
 const [e]=parse(wrap(timed));assert.equal(e.start.toISOString(),'2026-03-29T07:00:00.000Z');assert.equal(e.startTimeZone,'Europe/Madrid');
 assert.throws(()=>parse(wrap(timed.replace(';TZID=Europe/Madrid',''))));
});
