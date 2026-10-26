import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readNav, sortSessions } from '../src/client/pilot-list-preferences.ts'
import { sessionCreationDates } from '../src/pilot-session-dates.ts'
const rows=[{id:'a',displayTitle:'Beta',updatedAt:500},{id:'b',displayTitle:'Alpha',updatedAt:900},{id:'c',displayTitle:'Gamma',updatedAt:100}]
const dates={a:300,b:100,c:200}
test('list preferences sanitize invalid data and persist explicit archive visibility',()=>{
 assert.equal(readNav('bad').sort,'updated');assert.equal(readNav('{"sort":"bad"}').sort,'updated')
 assert.deepEqual(readNav('{"sort":"name","showArchived":true,"pinnedProjects":["p","p",null]}'),{sort:'name',showArchived:true,pinnedProjects:['p'],archivedProjects:[]})
})
test('all sort modes use their own timestamp axis, not activity for creation',()=>{
 const ids=mode=>sortSessions(rows,mode,dates,new Set()).map(r=>r.id)
 assert.deepEqual(ids('updated'),['b','a','c']);assert.deepEqual(ids('oldest'),['b','c','a']);assert.deepEqual(ids('name'),['b','a','c']);assert.deepEqual(ids('created'),['a','c','b']);assert.deepEqual(rows.map(r=>r.id),['a','b','c'])
})
test('pinned conversations lead all modes and unknown creation times sort last',()=>{
 assert.deepEqual(sortSessions(rows,'created',{a:100},new Set()).map(r=>r.id),['a','b','c'])
 assert.equal(sortSessions(rows,'name',dates,new Set(['c']))[0].id,'c')
})
test('creation dates only inspect catalogued ids and cache immutable host metadata',async()=>{
 const inspected=[];const controller={list:async()=>({items:[{sessionId:'a'},{sessionId:'b'}]}),inspect:async id=>{inspected.push(id);return {meta:{createdAt:id==='a'?123:456}}}}
 assert.deepEqual(await sessionCreationDates(controller,['a','a','../foreign']),{a:123});assert.deepEqual(inspected,['a'])
 assert.deepEqual(await sessionCreationDates(controller,['a','b']),{a:123,b:456});assert.deepEqual(inspected,['a','b'])
})
test('creation date reader rejects oversized or invalid requests, never fabricates missing dates',async()=>{
 const controller={list:async()=>({items:[{sessionId:'a'}]}),inspect:async()=>{throw new Error('gone')}}
 await assert.rejects(sessionCreationDates(controller,Array(101).fill('a')));await assert.rejects(sessionCreationDates(controller,[3]));assert.deepEqual(await sessionCreationDates(controller,['a']),{})
})
