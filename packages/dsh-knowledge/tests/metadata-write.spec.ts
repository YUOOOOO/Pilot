import { afterEach, describe, expect, it, vi } from 'vitest'
import { isMetadataWriteFailure, MetadataWriteError, MetadataWriter } from '../src/knowledge/metadata-write.js'

afterEach(() => vi.useRealTimers())

const locked = (code = 'EPERM') => Object.assign(new Error(`${code}: rename knowledge.json`), { code, syscall: 'rename' })

describe('metadata writes', () => {
  it.each(['EPERM', 'EBUSY', 'EACCES'])('retries transient %s and keeps later writes behind the retry', async code => {
    vi.useFakeTimers()
    const writer = new MetadataWriter()
    const order: string[] = []
    const put = vi.fn(async () => {
      order.push('put')
      if (order.length === 1) throw locked(code)
      return 'saved'
    })
    const first = writer.run(put)
    const second = writer.run(async () => { order.push('delete') })
    await vi.runAllTimersAsync()
    expect(await first).toBe('saved')
    await second
    expect(order).toEqual(['put', 'put', 'delete'])
  })

  it('bounds retries, rejects the failed write, and allows a later operation', async () => {
    vi.useFakeTimers()
    const writer = new MetadataWriter()
    const cause = locked()
    const operation = vi.fn(async () => { throw cause })
    const rejected = expect(writer.run(operation)).rejects.toMatchObject({ name: 'MetadataWriteError', cause })
    const later = writer.run(async () => 42)
    await vi.runAllTimersAsync()
    await rejected
    expect(operation).toHaveBeenCalledTimes(6)
    expect(await later).toBe(42)
    await writer.drain()
  })

  it('does not retry disk exhaustion or programming errors', async () => {
    const writer = new MetadataWriter()
    const disk = vi.fn(async () => { throw locked('ENOSPC') })
    await expect(writer.run(disk)).rejects.toBeInstanceOf(MetadataWriteError)
    expect(disk).toHaveBeenCalledTimes(1)
    const bug = new Error('invalid record')
    const invalid = vi.fn(async () => { throw bug })
    await expect(writer.run(invalid)).rejects.toBe(bug)
    expect(invalid).toHaveBeenCalledTimes(1)
  })

  it('recognizes wrapped metadata failures without looping over cyclic causes', async () => {
    vi.useFakeTimers()
    const writer = new MetadataWriter()
    const cause = new Error('backend write failed', { cause: locked() })
    const rejected = expect(writer.run(async () => { throw cause })).rejects.toBeInstanceOf(MetadataWriteError)
    await vi.runAllTimersAsync()
    await rejected
    expect(isMetadataWriteFailure(new Error('published generation', { cause: new MetadataWriteError(cause) }))).toBe(true)
    const cyclic = new Error('unrelated')
    cyclic.cause = cyclic
    expect(isMetadataWriteFailure(cyclic)).toBe(false)
  })
})
