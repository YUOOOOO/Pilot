/** Read immutable session creation metadata without activating an agent. */
export interface DatesController {
  list(input: Record<string, never>, signal: AbortSignal): Promise<{items:readonly {sessionId:string}[]}>
  inspect(id: never): Promise<{meta:{createdAt:number}}>
}
const cache=new WeakMap<object,Map<string,number>>()
export async function sessionCreationDates(controller: DatesController, input: unknown): Promise<Record<string,number>> {
  if(!Array.isArray(input)||input.length>100||input.some(id=>typeof id!=='string'||!id||id.length>256))throw new Error('Expected at most 100 session identities')
  const {items}=await controller.list({},new AbortController().signal)
  const allowed=new Set(items.map(item=>String(item.sessionId)))
  const known=cache.get(controller)??new Map<string,number>();cache.set(controller,known)
  const result:Record<string,number>={}
  for(const id of new Set(input as string[])){
    if(!allowed.has(id))continue
    let time=known.get(id)
    if(time===undefined){try{time=(await controller.inspect(id as never)).meta.createdAt;if(Number.isFinite(time))known.set(id,time)}catch{continue}}
    if(time!==undefined&&Number.isFinite(time))result[id]=time
  }
  return result
}
