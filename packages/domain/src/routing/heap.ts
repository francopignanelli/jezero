/**
 * Binary min-heap of (key, value) pairs on typed arrays. Ties on `key` are broken by the smaller
 * `value`, which makes search results deterministic across runs and platforms.
 */
export class MinHeap {
  private keys: Float64Array;
  private values: Int32Array;
  private count = 0;

  constructor(initialCapacity = 1024) {
    this.keys = new Float64Array(initialCapacity);
    this.values = new Int32Array(initialCapacity);
  }

  get size(): number {
    return this.count;
  }

  push(key: number, value: number): void {
    if (this.count === this.keys.length) this.grow();
    let i = this.count++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(key, value, this.keys[parent]!, this.values[parent]!)) break;
      this.keys[i] = this.keys[parent]!;
      this.values[i] = this.values[parent]!;
      i = parent;
    }
    this.keys[i] = key;
    this.values[i] = value;
  }

  /** Key of the minimum element. Only valid when size > 0. */
  peekKey(): number {
    return this.keys[0]!;
  }

  /** Removes and returns the value of the minimum element. Only valid when size > 0. */
  pop(): number {
    const top = this.values[0]!;
    const lastKey = this.keys[--this.count]!;
    const lastValue = this.values[this.count]!;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= this.count) break;
      const right = left + 1;
      let child = left;
      if (
        right < this.count &&
        this.less(this.keys[right]!, this.values[right]!, this.keys[left]!, this.values[left]!)
      ) {
        child = right;
      }
      if (!this.less(this.keys[child]!, this.values[child]!, lastKey, lastValue)) break;
      this.keys[i] = this.keys[child]!;
      this.values[i] = this.values[child]!;
      i = child;
    }
    this.keys[i] = lastKey;
    this.values[i] = lastValue;
    return top;
  }

  private less(k1: number, v1: number, k2: number, v2: number): boolean {
    return k1 < k2 || (k1 === k2 && v1 < v2);
  }

  private grow(): void {
    const keys = new Float64Array(this.keys.length * 2);
    const values = new Int32Array(this.values.length * 2);
    keys.set(this.keys);
    values.set(this.values);
    this.keys = keys;
    this.values = values;
  }
}
