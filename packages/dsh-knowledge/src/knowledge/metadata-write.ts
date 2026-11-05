/** Bounded retries at the domain boundary, where a rejected publish rolls back. */
const RETRY_DELAYS_MS = [20, 50, 100, 200, 400] as const
const TRANSIENT_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const IO_CODES = new Set([...TRANSIENT_CODES, 'EIO', 'ENOSPC', 'EROFS', 'EDQUOT', 'EMFILE', 'ENFILE'])

/** A failed durable write: callers must retain the previous metadata. */
export class MetadataWriteError extends Error {
  constructor(cause: unknown) {
    super(`knowledge metadata write failed; previous metadata retained: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = 'MetadataWriteError'
  }
}

/** Also recognizes a failed metadata acknowledgement after SQLite publication. */
export function isMetadataWriteFailure(error: unknown): boolean {
  return causes(error).some(value => value instanceof MetadataWriteError)
}

function causes(error: unknown): object[] {
  const seen = new Set<object>()
  while (typeof error === 'object' && error !== null && !seen.has(error)) {
    seen.add(error)
    error = (error as { cause?: unknown }).cause
  }
  return [...seen]
}

/** A single queue prevents a retrying put from overtaking a later delete. */
export class MetadataWriter {
  private chain: Promise<void> = Promise.resolve()

  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await operation()
        } catch (error) {
          const code = causes(error).map(value => (value as { code?: string }).code).find(value => value !== undefined && IO_CODES.has(value))
          if (code === undefined) throw error
          if (!TRANSIENT_CODES.has(code) || attempt >= RETRY_DELAYS_MS.length) throw new MetadataWriteError(error)
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
        }
      }
    })
    this.chain = next.then(() => {}, () => {})
    return next
  }

  drain(): Promise<void> { return this.chain }
}
