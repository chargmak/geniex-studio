/** Fixed-capacity line buffer for process logs. */
export class RingBuffer<T> {
  private buf: T[] = []
  private head = 0
  private count = 0
  private seq = 0

  constructor(readonly capacity: number) {}

  push(item: T): number {
    if (this.count < this.capacity) {
      this.buf.push(item)
      this.count++
    } else {
      this.buf[this.head] = item
      this.head = (this.head + 1) % this.capacity
    }
    return ++this.seq
  }

  /** Items in insertion order. */
  toArray(): T[] {
    if (this.count < this.capacity) return this.buf.slice()
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)]
  }

  tail(n: number): T[] {
    const arr = this.toArray()
    return arr.slice(Math.max(0, arr.length - n))
  }

  get size(): number {
    return this.count
  }

  /** Monotonic counter of pushes (lets clients ask for "lines since N"). */
  get sequence(): number {
    return this.seq
  }

  clear(): void {
    this.buf = []
    this.head = 0
    this.count = 0
  }
}
