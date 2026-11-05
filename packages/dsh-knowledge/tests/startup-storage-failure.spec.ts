import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config } from '../src/knowledge/config.js'
import { KnowledgeService } from '../src/knowledge/index.js'
import { MetadataWriteError } from '../src/knowledge/metadata-write.js'
import { DocumentGenerationCommitError, openStore, type Store } from '../src/knowledge/store.js'
import type { KnowledgeDocument } from '../src/knowledge/types.js'

// Replace only store opening: startup recovery and reindexing run through the
// real service against a pre-existing library, without native SQLite or I/O.
vi.mock('../src/knowledge/store.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/knowledge/store.js')>()
  return { ...actual, openStore: vi.fn(actual.openStore) }
})

const actualStore = await vi.importActual<typeof import('../src/knowledge/store.js')>('../src/knowledge/store.js')
const disposers: Array<() => Promise<unknown>> = []
const listeners: Array<(error: unknown) => void> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  for (const listener of listeners.splice(0)) process.off('unhandledRejection', listener)
  vi.restoreAllMocks()
  vi.mocked(openStore).mockReset()
})

function eperm(): Error {
  return Object.assign(new Error('EPERM: operation not permitted, rename knowledge.json.tmp -> knowledge.json'), { code: 'EPERM' })
}

async function library(firstText = '') {
  const store = await actualStore.openStore(undefined)
  await store.putBase({ id: 'base', name: 'Saved library', description: '', createdAt: 1, updatedAt: 1 })
  const first: KnowledgeDocument = {
    id: 'first', baseId: 'base', title: 'Interrupted first document', sourceType: 'text',
    rawText: firstText, charCount: firstText.length, chunkCount: 0, incomplete: true, createdAt: 1, updatedAt: 1,
  }
  const next: KnowledgeDocument = {
    ...first, id: 'next', title: 'Recoverable next document', rawText: 'Preserved next document content.', charCount: 32,
  }
  await store.putDocument(first)
  await store.putDocument(next)
  return { store, first, next }
}

async function mount(store: Store, resumeInterruptedOnStartup = true) {
  vi.mocked(openStore).mockResolvedValue(store)
  const ctx = new Context()
  const warnings: string[] = []
  const unhandled: unknown[] = []
  const listener = (error: unknown): void => { unhandled.push(error) }
  process.on('unhandledRejection', listener)
  listeners.push(listener)
  ctx.logger.exporter({ levels: { default: 3 }, export(message) {
    if (message.type === 'warn') warnings.push(message.args.map(String).join(' '))
  } })
  ctx.provide('webServer', { register: () => () => {} })
  const fiber = await ctx.plugin(KnowledgeService, { ...Config(), resumeInterruptedOnStartup, urlRefreshHours: 0 })
  disposers.push(() => fiber.dispose())
  const service = ctx.get('knowledge') as KnowledgeService
  await service.whenReady()
  return { service, warnings, unhandled }
}

async function expectRecovered(store: Store, id: string): Promise<void> {
  await vi.waitFor(() => {
    expect(store.getDocument(id)?.incomplete).toBeUndefined()
    expect(store.listChunksByDoc(id).length).toBeGreaterThan(0)
  })
  // Let Node emit any detached rejection before checking the captured events.
  await new Promise<void>(resolve => setImmediate(resolve))
}

describe('startup recovery with unavailable metadata storage (#55)', () => {
  it('continues after a permanent EPERM while recording an actual recovery failure', async () => {
    const { store, first, next } = await library()
    const put = store.putDocument.bind(store)
    const writes = vi.spyOn(store, 'putDocument').mockImplementation(async doc => {
      if (doc.id === first.id) throw eperm()
      await put(doc)
    })

    const { warnings, unhandled } = await mount(store)
    await expectRecovered(store, next.id)

    expect(writes.mock.calls.some(([doc]) => doc.id === first.id && doc.incomplete === false)).toBe(true)
    expect(store.getDocument(first.id)).toEqual(first)
    expect(warnings.some(message => message.includes('could not record failed recovery') && message.includes('EPERM'))).toBe(true)
    expect(unhandled).toEqual([])
  })

  it('preserves resumable metadata when the initial reindex write fails, without calling it an embedding failure', async () => {
    const { store, first, next } = await library('First document still has recoverable text.')
    const put = store.putDocument.bind(store)
    let failed = false
    const writes = vi.spyOn(store, 'putDocument').mockImplementation(async doc => {
      if (doc.id === first.id && !failed) {
        failed = true
        throw new MetadataWriteError(eperm())
      }
      await put(doc)
    })

    const { warnings, unhandled } = await mount(store)
    await expectRecovered(store, next.id)

    expect(store.getDocument(first.id)).toEqual(first)
    expect(writes.mock.calls.filter(([doc]) => doc.id === first.id)).toHaveLength(1)
    expect(warnings.some(message => message.includes('recovery deferred for first'))).toBe(true)
    expect(unhandled).toEqual([])
  })

  it('marks the remaining documents when auto-resume is disabled and the first status write fails', async () => {
    const { store, first, next } = await library('Recoverable first document text.')
    const put = store.putDocument.bind(store)
    vi.spyOn(store, 'putDocument').mockImplementation(async doc => {
      if (doc.id === first.id) throw new MetadataWriteError(eperm())
      await put(doc)
    })

    const { warnings, unhandled } = await mount(store, false)
    await vi.waitFor(() => expect(store.getDocument(next.id)?.errorCode).toBe('interrupted'))
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(store.getDocument(next.id)?.incomplete).toBeUndefined()
    expect(store.getDocument(first.id)).toEqual(first)
    expect(warnings.some(message => message.includes('could not mark interrupted import first failed'))).toBe(true)
    expect(unhandled).toEqual([])
  })

  it('isolates a document lookup failure, including a second failure while recording its status', async () => {
    const { store, first, next } = await library()
    const get = store.getDocument.bind(store)
    vi.spyOn(store, 'getDocument').mockImplementation(id => {
      if (id === first.id) throw new Error('metadata lookup unavailable')
      return get(id)
    })

    const { warnings, unhandled } = await mount(store)
    await expectRecovered(store, next.id)

    expect(get(first.id)).toEqual(first)
    expect(warnings.some(message => message.includes('could not record failed recovery for first'))).toBe(true)
    expect(unhandled).toEqual([])
  })

  it('keeps a published generation authoritative when its metadata acknowledgement failed', async () => {
    const { store, first, next } = await library('Published first document content.')
    const commit = store.commitDocumentGeneration.bind(store)
    vi.spyOn(store, 'commitDocumentGeneration').mockImplementation(async (doc, chunks) => {
      await commit(doc, chunks)
      if (doc.id === first.id) throw new DocumentGenerationCommitError({ cause: new Error('metadata acknowledgement unavailable') })
    })
    const writes = vi.spyOn(store, 'putDocument')

    const { unhandled } = await mount(store)
    await expectRecovered(store, next.id)

    expect(store.getDocument(first.id)?.incomplete).toBeUndefined()
    expect(store.getDocument(first.id)?.errorCode).toBeUndefined()
    expect(store.listChunksByDoc(first.id).length).toBeGreaterThan(0)
    expect(writes.mock.calls.filter(([doc]) => doc.id === first.id)).toHaveLength(1)
    expect(unhandled).toEqual([])
  })

  it('observes unexpected background recovery rejection through the startup recovery chain', async () => {
    const { store } = await library()
    const prototype = KnowledgeService.prototype as unknown as { resumeInterruptedDocuments(ids: readonly string[]): Promise<void> }
    vi.spyOn(prototype, 'resumeInterruptedDocuments').mockRejectedValue(eperm())

    const { warnings, unhandled } = await mount(store)
    await vi.waitFor(() => expect(warnings.some(message => message.includes('interrupted-import recovery failed: EPERM'))).toBe(true))
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(unhandled).toEqual([])
  })
})
