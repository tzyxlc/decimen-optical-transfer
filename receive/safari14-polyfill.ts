// Safari 14 / iOS 14: the emscripten glue for decimen-codec needs a few
// primitives that shipped in Safari 15. Without them DecimenCodec() throws
// (or hangs) and the camera appears to "see nothing".
//
// - BigInt64Array / BigUint64Array: HEAP64 views of WASM memory
// - BigInt.asUintN / asIntN: embind unsigned i64 wire types
// - Array.prototype.at: C++ exception path in the glue

export function installSafari14Polyfills(global: typeof globalThis = globalThis): void {
  if (typeof Array.prototype.at !== "function") {
    Object.defineProperty(Array.prototype, "at", {
      configurable: true,
      writable: true,
      value(this: unknown[], index: number) {
        const n = Math.trunc(index) || 0;
        const k = n >= 0 ? n : this.length + n;
        if (k < 0 || k >= this.length) return undefined;
        return this[k];
      },
    });
  }

  if (typeof BigInt === "function") {
    if (typeof BigInt.asUintN !== "function") {
      Object.defineProperty(BigInt, "asUintN", {
        configurable: true,
        writable: true,
        value(bits: number, value: bigint) {
          const width = BigInt(bits);
          return BigInt(value) & ((1n << width) - 1n);
        },
      });
    }
    if (typeof BigInt.asIntN !== "function") {
      Object.defineProperty(BigInt, "asIntN", {
        configurable: true,
        writable: true,
        value(bits: number, value: bigint) {
          const width = BigInt(bits);
          const mask = (1n << width) - 1n;
          const u = BigInt(value) & mask;
          const sign = 1n << (width - 1n);
          return u & sign ? u - (sign << 1n) : u;
        },
      });
    }
  }

  if (typeof global.BigInt64Array === "function") return;
  if (typeof BigInt !== "function") return;

  const make = (unsigned: boolean) => {
    type View = {
      buffer: ArrayBuffer;
      byteOffset: number;
      byteLength: number;
      length: number;
      BYTES_PER_ELEMENT: number;
      subarray(begin?: number, end?: number): View;
      set(array: ArrayLike<bigint | number>, offset?: number): void;
      [i: number]: bigint;
    };
    const Ctor = function BigIntArray(
      buffer?: ArrayBuffer | number,
      byteOffset?: number,
      length?: number,
    ) {
      let buf: ArrayBuffer;
      let off = 0;
      let len: number;
      if (typeof buffer === "number") {
        len = buffer;
        buf = new ArrayBuffer(len * 8);
      } else if (buffer instanceof ArrayBuffer) {
        buf = buffer;
        off = byteOffset ?? 0;
        len = length ?? ((buf.byteLength - off) >> 3);
      } else {
        buf = new ArrayBuffer(0);
        len = 0;
      }
      const view = new DataView(buf, off, len * 8);
      const read = (i: number) => {
        const lo = view.getUint32(i * 8, true);
        const hi = view.getUint32(i * 8 + 4, true);
        const raw = (BigInt(hi) << 32n) | BigInt(lo);
        if (unsigned) return raw;
        return raw >= 0x8000000000000000n ? raw - 0x10000000000000000n : raw;
      };
      const write = (i: number, value: number | bigint) => {
        let v = BigInt(value);
        if (!unsigned && v < 0n) v += 0x10000000000000000n;
        v &= 0xffffffffffffffffn;
        view.setUint32(i * 8, Number(v & 0xffffffffn), true);
        view.setUint32(i * 8 + 4, Number(v >> 32n), true);
      };
      const target = {
        buffer: buf,
        byteOffset: off,
        byteLength: len * 8,
        length: len,
        BYTES_PER_ELEMENT: 8,
        subarray(begin = 0, end = len) {
          const s = begin < 0 ? len + begin : begin;
          const e = end < 0 ? len + end : end;
          return new Ctor(buf, off + s * 8, Math.max(0, e - s));
        },
        set(array: ArrayLike<bigint | number>, offset = 0) {
          for (let i = 0; i < array.length; i++) write(offset + i, array[i]!);
        },
      };
      return new Proxy(target, {
        get(t, prop) {
          if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
            const i = Number(prop);
            if (i >= 0 && i < len) return read(i);
          }
          return Reflect.get(t, prop);
        },
        set(t, prop, value) {
          if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
            const i = Number(prop);
            if (i >= 0 && i < len) {
              write(i, value as number | bigint);
              return true;
            }
          }
          Reflect.set(t, prop, value);
          return true;
        },
      }) as View;
    } as unknown as {
      new (buffer?: ArrayBuffer | number, byteOffset?: number, length?: number): View;
      BYTES_PER_ELEMENT: number;
    };
    Ctor.BYTES_PER_ELEMENT = 8;
    return Ctor;
  };

  Object.defineProperty(global, "BigInt64Array", { configurable: true, writable: true, value: make(false) });
  Object.defineProperty(global, "BigUint64Array", { configurable: true, writable: true, value: make(true) });
}

installSafari14Polyfills();
